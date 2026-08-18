import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { StateService } from '../state/state.service';
import { AiMeetingSummary, MeetingDocument } from '../state/types';

@Injectable()
export class SummaryService {
  constructor(
    private readonly auth: AuthService,
    private readonly state: StateService,
  ) {}

  async generate(userId: string, meetingId: string): Promise<AiMeetingSummary> {
    const provider = this.auth.getDefaultAiProvider(userId);
    if (!provider) {
      throw new ServiceUnavailableException('请先在左下角用户菜单中配置并设置默认 AI 供应商');
    }
    const document = this.state.getMeetingDocument(meetingId);
    if (!document) throw new NotFoundException('会议不存在');
    if (!document.entries.length) throw new BadRequestException('当前会议还没有记录，无法生成 AI 总结');

    const endpoint = provider.baseUrl.endsWith('/chat/completions')
      ? provider.baseUrl
      : `${provider.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: '你是严谨的中文会议纪要助手。只输出合法 JSON，不要输出 Markdown。字段必须为 summary、keyPoints、decisions、risks、nextSteps；summary 为字符串，其他字段均为字符串数组。不得编造未在会议内容中出现的事实。',
            },
            { role: 'user', content: this.buildPrompt(document) },
          ],
        }),
        signal: controller.signal,
      });
    } catch (error: any) {
      const reason = error?.name === 'AbortError' ? '请求超时' : '连接失败';
      throw new ServiceUnavailableException(`无法连接默认 AI 供应商「${provider.name}」：${reason}`);
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const rawDetail = String(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
      const detail = (provider.apiKey ? rawDetail.replaceAll(provider.apiKey, '[redacted]') : rawDetail).slice(0, 240);
      throw new BadGatewayException(`AI 供应商「${provider.name}」请求失败：${detail}`);
    }
    const rawContent = this.extractContent(payload?.choices?.[0]?.message?.content);
    const parsed = this.parseSummary(rawContent);
    return this.state.saveAiSummary(meetingId, {
      ...parsed,
      provider: { id: provider.id, name: provider.name, model: provider.model },
      generatedAt: Date.now(),
    });
  }

  private buildPrompt(document: MeetingDocument): string {
    const people = new Map(document.persons.map((person) => [person.id, person.name]));
    const records = document.entries.slice(0, 200).map((entry, index) => {
      const speaker = entry.speakerId ? people.get(entry.speakerId) || '未知人员' : '会议记录';
      const topic = entry.topic ? `；主题：${entry.topic}` : '';
      return `${index + 1}. [${entry.time}] ${speaker}${topic}：${entry.content.slice(0, 1200)}`;
    }).join('\n');
    const todos = document.todos.map((todo) => {
      const assignee = todo.assigneeId ? people.get(todo.assigneeId) || '未知人员' : '未指派';
      return `- [${todo.done ? '已完成' : '待处理'}] ${todo.content}（负责人：${assignee}）`;
    }).join('\n') || '无';
    const meeting = document.meeting;
    return [
      `会议：${meeting.title || '未命名会议'}`,
      `日期：${meeting.date || '未设置'}`,
      `时间：${meeting.startTime || '未设置'} - ${meeting.endTime || '未设置'}`,
      `地点：${meeting.location || '未设置'}`,
      '',
      '会议记录：',
      records,
      '',
      '现有待办：',
      todos,
      '',
      '请提炼简洁摘要、关键要点、已明确决策、风险或阻塞、下一步行动。没有依据的分类返回空数组。',
    ].join('\n');
  }

  private extractContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => typeof part === 'string' ? part : String(part?.text || '')).join('');
    }
    throw new BadGatewayException('AI 供应商返回了无法识别的内容');
  }

  private parseSummary(content: string): Omit<AiMeetingSummary, 'provider' | 'generatedAt'> {
    const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < start) throw new BadGatewayException('AI 返回内容不是有效的总结 JSON');
    let parsed: any;
    try { parsed = JSON.parse(cleaned.slice(start, end + 1)); }
    catch { throw new BadGatewayException('AI 返回的总结 JSON 无法解析'); }
    const summary = String(parsed?.summary || '').trim();
    if (!summary) throw new BadGatewayException('AI 返回的总结为空');
    const stringArray = (value: unknown) => Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [];
    return {
      summary: summary.slice(0, 4000),
      keyPoints: stringArray(parsed.keyPoints),
      decisions: stringArray(parsed.decisions),
      risks: stringArray(parsed.risks),
      nextSteps: stringArray(parsed.nextSteps),
    };
  }
}
