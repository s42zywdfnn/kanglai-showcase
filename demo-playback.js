export function caseStageIndex(stages, elapsedSeconds, stageStarts) {
  let index = 0;
  for (let i = 1; i < stages.length && (stageStarts?.[i] ?? stages[i].start) <= elapsedSeconds; i++) index = i;
  return index;
}

export function applyDemoEvent(data, event) {
  if (event.type === 'enrollment') {
    data.cohort.total++;
    data.programs.find(row => row.name === event.service).activeUsers++;
    data.cohort.age.find(row => row.label === event.age).value++;
    data.cohort.gender.find(row => row.label === event.gender).value++;
    data.cohort.regions.find(row => row.name === event.region).value++;
    for (const id of event.needs) data.cohort.needs.find(row => row.id === id).value++;
    for (const label of event.lifestyle) data.cohort.lifestyle.find(row => row.label === label).value++;
  } else if (event.type === 'action') {
    data.operations.actionRecords++;
    data.operations.trend.at(-1).actions++;
  } else if (event.type === 'draft-submitted') {
    data.operations.aiDrafts++;
    data.operations.trend.at(-1).drafts++;
    data.operations.pendingReview++;
  } else if (event.type === 'feedback') {
    data.operations.feedbackRecords++;
  } else {
    throw new Error(`未知模拟事件：${event.type}`);
  }
}
