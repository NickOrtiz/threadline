// To-dos you add in Threadline → Threadline WorkItem.

import type { WorkItem } from '../../core/schema/entities.ts';
import type { Todo } from '../../storage/todos.ts';

export function normalizeTodo(todo: Todo, syncedAt: string): WorkItem {
  return {
    id: `todo-${todo.id}`,
    projectId: todo.projectId,
    threadId: null,
    title: todo.title,
    kind: 'task',
    status: todo.status === 'done' ? 'done' : 'open',
    priority: null,
    group: null,
    parentId: null,
    startAt: null,
    dueAt: todo.dueAt,
    completedAt: todo.completedAt,
    estimatedMinutes: todo.estimatedMinutes,
    nextAction: null,
    blockedBy: [],
    codeReview: null,
    stage: null,
    needsResponse: false,
    mine: true,
    updatedAt: todo.updatedAt,
    source: { type: 'manual', id: todo.id, url: null, syncedAt },
  };
}
