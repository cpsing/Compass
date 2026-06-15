import { openDb } from './connection.ts';
import { newId, now } from '../shared/ids.ts';

export interface CodeTodo {
  id: string;
  feature_node_id: string;
  ai_run_id: string | null;
  content: string;
  file_path: string | null;
  line_number: number | null;
  done: 0 | 1;
  created_by: 'ai' | 'user';
  created_at: number;
  completed_at: number | null;
}

export interface CreateTodoInput {
  feature_node_id: string;
  content: string;
  ai_run_id?: string | null;
  file_path?: string | null;
  line_number?: number | null;
  created_by: 'ai' | 'user';
}

export function createTodo(input: CreateTodoInput): CodeTodo {
  const db = openDb();
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO code_todos
       (id, feature_node_id, ai_run_id, content, file_path, line_number, done, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    input.feature_node_id,
    input.ai_run_id ?? null,
    input.content,
    input.file_path ?? null,
    input.line_number ?? null,
    input.created_by,
    ts,
  );
  return getTodo(id)!;
}

export function getTodo(id: string): CodeTodo | null {
  const db = openDb();
  const row = db
    .prepare('SELECT * FROM code_todos WHERE id = ?')
    .get(id) as CodeTodo | undefined;
  return row ?? null;
}

export interface ListTodosFilters {
  feature_node_id?: string;
  project_id?: string;
  done?: boolean;
  limit?: number;
}

export function listTodos(filters: ListTodosFilters = {}): CodeTodo[] {
  const db = openDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.feature_node_id) {
    where.push('code_todos.feature_node_id = ?');
    params.push(filters.feature_node_id);
  }
  if (filters.project_id) {
    where.push('feature_nodes.project_id = ?');
    params.push(filters.project_id);
  }
  if (filters.done !== undefined) {
    where.push('code_todos.done = ?');
    params.push(filters.done ? 1 : 0);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = filters.limit ?? 100;
  return db
    .prepare(
      `SELECT code_todos.* FROM code_todos
       JOIN feature_nodes ON feature_nodes.id = code_todos.feature_node_id
       ${whereSql}
       ORDER BY code_todos.created_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as CodeTodo[];
}

export function markTodoDone(id: string, doneAt: number = now()): void {
  const db = openDb();
  const info = db
    .prepare('UPDATE code_todos SET done = 1, completed_at = ? WHERE id = ?')
    .run(doneAt, id);
  if (info.changes === 0) throw new Error(`todo not found: ${id}`);
}
