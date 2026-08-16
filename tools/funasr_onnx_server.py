import asyncio
import os
import subprocess
import sys
import tempfile
import threading
import types
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from modelscope.hub.snapshot_download import snapshot_download
# funasr_onnx 0.4.1 imports its optional SenseVoice backend eagerly. Paraformer
# itself does not use torch, so provide an import-only placeholder and keep this
# service free of the multi-gigabyte PyTorch dependency.
sys.modules.setdefault("torch", types.ModuleType("torch"))
from funasr_onnx.paraformer_bin import Paraformer
from funasr_onnx.punc_bin import CT_Transformer
from funasr_onnx.vad_bin import Fsmn_vad
sys.modules.pop("torch", None)

ASR_MODEL = os.getenv(
    "FUNASR_ASR_MODEL",
    "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-onnx",
)
PUNC_MODEL = os.getenv(
    "FUNASR_PUNC_MODEL",
    "iic/punc_ct-transformer_zh-cn-common-vocab272727-onnx",
)
VAD_MODEL = os.getenv("FUNASR_VAD_MODEL", "iic/speech_fsmn_vad_zh-cn-16k-common-onnx")
MODEL_REVISION = os.getenv("FUNASR_MODEL_REVISION", "v2.0.5")
THREADS = max(1, int(os.getenv("FUNASR_THREADS", str(min(os.cpu_count() or 4, 8)))))

app = FastAPI(title="Meeting Minutes FunASR ONNX", version="1.0.0")
asr_model = None
punc_model = None
vad_model = None
inference_lock = threading.Lock()


def load_model(model_id: str) -> str:
    return snapshot_download(model_id, revision=MODEL_REVISION)


@app.on_event("startup")
def startup() -> None:
    global asr_model, punc_model, vad_model
    asr_dir = load_model(ASR_MODEL)
    punc_dir = load_model(PUNC_MODEL)
    vad_dir = load_model(VAD_MODEL)
    asr_model = Paraformer(
        asr_dir,
        batch_size=1,
        device_id=-1,
        quantize=Path(asr_dir, "model_quant.onnx").exists(),
        intra_op_num_threads=THREADS,
    )
    punc_model = CT_Transformer(
        punc_dir,
        batch_size=1,
        device_id=-1,
        quantize=Path(punc_dir, "model_quant.onnx").exists(),
        intra_op_num_threads=THREADS,
    )
    vad_model = Fsmn_vad(
        vad_dir,
        batch_size=1,
        device_id=-1,
        quantize=Path(vad_dir, "model_quant.onnx").exists(),
        intra_op_num_threads=THREADS,
    )


@app.get("/health")
def health():
    return {"status": "ok", "engine": "funasr-onnx", "model": "paraformer", "ready": asr_model is not None}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "paraformer-zh", "object": "model", "owned_by": "local"}]}


def extract_text(result) -> str:
    if not result:
        return ""
    item = result[0] if isinstance(result, list) else result
    if isinstance(item, dict):
        if "text" in item:
            return str(item["text"])
        predictions = item.get("preds", "")
        if isinstance(predictions, tuple):
            return str(predictions[0])
        return str(predictions)
    return str(item)


def recognize_short_wav(wav_path: str) -> str:
    with inference_lock:
        raw_text = extract_text(asr_model([wav_path])).strip()
        if not raw_text or punc_model is None:
            return raw_text
        punctuated = punc_model(raw_text)
        return str(punctuated[0] if isinstance(punctuated, tuple) else punctuated).strip()


def speech_ranges(wav_path: str, duration_ms: int) -> list[tuple[int, int]]:
    if vad_model is None:
        return [(0, duration_ms)]
    with inference_lock:
        result = vad_model(wav_path)
    ranges = result[0] if isinstance(result, list) and result else []
    valid = [(max(0, int(item[0])), min(duration_ms, int(item[1]))) for item in ranges if len(item) >= 2 and item[1] > item[0]]
    return valid or [(0, duration_ms)]


def group_ranges(ranges: list[tuple[int, int]], max_ms: int = 20000) -> list[tuple[int, int]]:
    groups: list[tuple[int, int]] = []
    for start, end in ranges:
        # Split unusually long VAD regions before grouping.
        pieces = []
        cursor = start
        while end - cursor > max_ms:
            pieces.append((cursor, cursor + max_ms))
            cursor += max_ms
        pieces.append((cursor, end))
        for piece_start, piece_end in pieces:
            if groups and piece_end - groups[-1][0] <= max_ms:
                groups[-1] = (groups[-1][0], piece_end)
            else:
                groups.append((piece_start, piece_end))
    return groups


def recognize_long_wav(wav_path: str) -> str:
    audio, sample_rate = sf.read(wav_path, dtype="float32")
    if audio.ndim > 1: audio = audio.mean(axis=1)
    duration_ms = int(len(audio) * 1000 / sample_rate)
    if duration_ms <= 20000:
        return recognize_short_wav(wav_path)
    ranges = group_ranges(speech_ranges(wav_path, duration_ms))
    texts: list[str] = []
    with tempfile.TemporaryDirectory(prefix="meeting-funasr-vad-") as directory:
        for index, (start_ms, end_ms) in enumerate(ranges):
            # Small context padding prevents VAD boundaries from clipping syllables.
            start_sample = max(0, int((start_ms - 180) * sample_rate / 1000))
            end_sample = min(len(audio), int((end_ms + 220) * sample_rate / 1000))
            segment_path = Path(directory, f"segment-{index:04d}.wav")
            sf.write(segment_path, audio[start_sample:end_sample], sample_rate, subtype="PCM_16")
            text = recognize_short_wav(str(segment_path)).strip()
            if text: texts.append(text)
    return "".join(texts)


def recognize_pcm(samples: np.ndarray, sample_rate: int) -> str:
    with tempfile.TemporaryDirectory(prefix="meeting-funasr-stream-") as directory:
        wav = Path(directory, "speech.wav")
        sf.write(wav, samples, sample_rate, subtype="PCM_16")
        return recognize_short_wav(str(wav))


@app.websocket("/v1/audio/realtime")
async def realtime(websocket: WebSocket):
    await websocket.accept()
    sample_rate = 48000
    utterance: list[np.ndarray] = []
    utterance_samples = 0
    silence_samples = 0
    speech_started = False
    last_decode_samples = 0
    utterance_id = 0
    partial_task = None
    send_lock = asyncio.Lock()

    async def send_result(samples: np.ndarray, current_id: int, final: bool):
        if samples.size < int(sample_rate * .25):
            return
        text = await asyncio.to_thread(recognize_pcm, samples, sample_rate)
        if text:
            async with send_lock:
                await websocket.send_json({"type": "final" if final else "partial", "text": text, "utteranceId": current_id})

    async def finalize():
        nonlocal utterance, utterance_samples, silence_samples, speech_started, last_decode_samples, utterance_id, partial_task
        if not speech_started or utterance_samples < int(sample_rate * .3):
            utterance = []; utterance_samples = 0; silence_samples = 0; speech_started = False; last_decode_samples = 0
            return
        snapshot = np.concatenate(utterance)
        trailing = min(silence_samples, int(sample_rate * .55))
        if trailing: snapshot = snapshot[:-trailing]
        current_id = utterance_id
        utterance_id += 1
        utterance = []; utterance_samples = 0; silence_samples = 0; speech_started = False; last_decode_samples = 0
        await send_result(snapshot, current_id, True)
        partial_task = None

    try:
        while True:
            message = await websocket.receive()
            if message.get("text") is not None:
                import json
                payload = json.loads(message["text"] or "{}")
                if payload.get("type") == "start": sample_rate = max(8000, min(96000, int(payload.get("sampleRate") or sample_rate)))
                elif payload.get("type") in ("flush", "end"):
                    await finalize()
                    if payload.get("type") == "end": break
                continue
            data = message.get("bytes")
            if not data: continue
            pcm = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
            rms = float(np.sqrt(np.mean(pcm * pcm))) if pcm.size else 0
            if rms >= .012:
                speech_started = True
                silence_samples = 0
            elif speech_started:
                silence_samples += pcm.size
            if speech_started:
                utterance.append(pcm); utterance_samples += pcm.size
                enough_new_audio = utterance_samples - last_decode_samples >= int(sample_rate * .75)
                if enough_new_audio and (partial_task is None or partial_task.done()):
                    snapshot = np.concatenate(utterance)
                    last_decode_samples = utterance_samples
                    partial_task = asyncio.create_task(send_result(snapshot, utterance_id, False))
                # Natural pauses commit a sentence; the hard limit keeps a long
                # monologue bounded so latency never grows with meeting length.
                if silence_samples >= int(sample_rate * .7) or utterance_samples >= int(sample_rate * 20):
                    await finalize()
    except WebSocketDisconnect:
        pass
    except Exception as error:
        try: await websocket.send_json({"type": "error", "message": str(error)})
        except Exception: pass
    finally:
        if partial_task and not partial_task.done(): partial_task.cancel()
        try: await websocket.close()
        except Exception: pass


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("paraformer-zh"),
    response_format: str = Form("json"),
):
    if asr_model is None:
        raise HTTPException(503, "模型仍在加载")
    suffix = Path(file.filename or "audio.webm").suffix or ".webm"
    with tempfile.TemporaryDirectory(prefix="meeting-funasr-") as directory:
        source = Path(directory, f"source{suffix}")
        wav = Path(directory, "audio.wav")
        source.write_bytes(await file.read())
        process = subprocess.run(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-i", str(source), "-ac", "1", "-ar", "16000", str(wav)],
            capture_output=True,
            text=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if process.returncode != 0:
            raise HTTPException(400, "无法读取该录音格式")
        text = recognize_long_wav(str(wav))
    if response_format == "text":
        return text
    return {"text": text, "language": "zh", "model": model}
