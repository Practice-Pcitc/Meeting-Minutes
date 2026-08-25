export function speakerAssignmentTargets(clusters, selectedCluster, personId) {
  if (!selectedCluster) return []
  if (!personId) return [selectedCluster]

  return [
    selectedCluster,
    ...clusters.filter(cluster => cluster.key !== selectedCluster.key
      && cluster.speakerCode === selectedCluster.speakerCode
      && !cluster.manuallyAssigned),
  ]
}

export async function applySpeakerAssignmentTargets(targets, selectedKey, update) {
  let savedCount = 0
  try {
    for (const target of targets) {
      await update(target, target.key === selectedKey)
      savedCount += 1
    }
    return savedCount
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    failure.savedCount = savedCount
    throw failure
  }
}

export function resolveSpeakerIdentity(stored, anchor) {
  const confirmed = stored?.assignment?.source === 'user-confirmed'
  const person = confirmed ? stored.person : (anchor?.person || stored?.person || null)
  const source = confirmed || (!anchor && stored)
    ? stored?.assignment?.source || ''
    : (anchor ? 'manual-anchor' : '')
  return { person, source }
}
