/**
 * Hierarquia de tarefas (docs/event-contract.md): raiz sem pai, filha com pai
 * existente na mesma raiz e sem ciclos. Extraído de `scripts/contract.test.mjs`.
 */

import { ensure } from "./events.ts";

export interface TaskNode {
  task_id: string;
  root_task_id: string;
  parent_task_id?: string | null;
}

/** Valida a hierarquia. Lança `ContractError` na primeira inconsistência. */
export function validateTaskHierarchy(tasks: readonly TaskNode[]): true {
  const byId = new Map<string, TaskNode>();

  for (const task of tasks) {
    ensure(task.task_id, "task_id obrigatório");
    ensure(task.root_task_id, "root_task_id obrigatório");
    ensure(!byId.has(task.task_id), `task_id duplicado: ${task.task_id}`);
    byId.set(task.task_id, task);
  }

  for (const task of tasks) {
    if (task.task_id === task.root_task_id) {
      ensure((task.parent_task_id ?? null) === null, "Tarefa raiz não pode ter pai");
      continue;
    }

    ensure(task.parent_task_id, `Tarefa filha ${task.task_id} precisa de parent_task_id`);
    const root = byId.get(task.root_task_id);
    ensure(root, `Tarefa raiz não encontrada para ${task.task_id}`);
    ensure(root.task_id === root.root_task_id, `Referência não aponta para uma tarefa raiz: ${task.task_id}`);
    ensure((root.parent_task_id ?? null) === null, `Tarefa raiz não pode ter pai: ${task.root_task_id}`);

    const parent = byId.get(task.parent_task_id);
    ensure(parent, `Tarefa pai não encontrada para ${task.task_id}`);
    ensure(parent.root_task_id === task.root_task_id, `Pai pertence a outra raiz: ${task.task_id}`);
  }

  for (const task of tasks) {
    const visited = new Set<string>();
    let current: TaskNode | undefined = task;
    while (current?.parent_task_id) {
      ensure(!visited.has(current.task_id), `Ciclo detectado na hierarquia da tarefa ${task.task_id}`);
      visited.add(current.task_id);
      current = byId.get(current.parent_task_id);
      ensure(current, `Tarefa pai não encontrada para ${task.task_id}`);
    }
  }
  return true;
}
