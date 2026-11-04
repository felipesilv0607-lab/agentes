
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const contractPath = path.resolve(__dirname, '../docs/event-contract.md');

const contract = fs.readFileSync(contractPath, 'utf8');

function extractJsonBlocks(markdown) {
  const blocks = [];
  const regex = /```json\s*([\s\S]*?)```/gi;
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch (error) {
      throw new Error(
        `Bloco JSON inválido próximo ao caractere ${match.index}: ${error.message}`
      );
    }
  }

  return blocks;
}

const jsonBlocks = extractJsonBlocks(contract);

const eventTypes = [
  'task',
  'assignment',
  'execution',
  'result',
  'evidence',
  'review',
  'blocker'
];

const requiredEnvelopeFields = [
  'event_id',
  'source',
  'event_type',
  'schema_version',
  'occurred_at',
  'task_id',
  'root_task_id',
  'aggregate',
  'payload'
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRfc3339Timestamp(value) {
  if (typeof value !== 'string') return false;
  const pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  return pattern.test(value) && !Number.isNaN(Date.parse(value));
}

function isUriReference(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || /\s/.test(value)) {
    return false;
  }

  try {
    new URL(value, 'https://agente-s.invalid');
    return true;
  } catch {
    return false;
  }
}

function validateEventEnvelope(event) {
  assert.ok(isObject(event), 'Evento precisa ser um objeto');

  for (const field of requiredEnvelopeFields) {
    assert.ok(
      Object.hasOwn(event, field),
      `Campo obrigatorio ausente: ${field}`
    );
  }

  assert.equal(typeof event.event_id, 'string');
  assert.ok(event.event_id.trim().length > 0, 'event_id nao pode ser vazio');

  assert.ok(isUriReference(event.source), 'source precisa ser URI-reference valida e nao vazia');
  assert.ok(
    eventTypes.includes(event.event_type),
    `Tipo de evento desconhecido: ${event.event_type}`
  );
  assert.equal(event.schema_version, '1.0', 'schema_version nao suportada; versao esperada: 1.0');

  assert.equal(typeof event.occurred_at, 'string');
  assert.ok(
    isRfc3339Timestamp(event.occurred_at),
    'occurred_at precisa seguir RFC 3339 com timezone explicito'
  );

  assert.equal(typeof event.task_id, 'string');
  assert.ok(event.task_id.trim().length > 0, 'task_id nao pode ser vazio');
  assert.equal(typeof event.root_task_id, 'string');
  assert.ok(event.root_task_id.trim().length > 0, 'root_task_id nao pode ser vazio');

  assert.ok(isObject(event.aggregate), 'aggregate precisa ser objeto');
  assert.ok(eventTypes.includes(event.aggregate.type), 'aggregate.type invalido');
  assert.equal(
    event.aggregate.type,
    event.event_type,
    'aggregate.type deve corresponder a event_type'
  );
  assert.equal(typeof event.aggregate.id, 'string');
  assert.ok(event.aggregate.id.trim().length > 0, 'aggregate.id nao pode ser vazio');
  assert.ok(
    Number.isInteger(event.aggregate.version) && event.aggregate.version >= 1,
    'aggregate.version precisa ser inteiro positivo'
  );

  assert.ok(isObject(event.payload), 'payload precisa ser objeto');

  const aggregateIdField = event.aggregate.type === 'task'
    ? null
    : `${event.aggregate.type}_id`;
  const expectedAggregateId = aggregateIdField === null
    ? event.task_id
    : event.payload[aggregateIdField];

  assert.equal(
    event.aggregate.id,
    expectedAggregateId,
    'aggregate.id deve corresponder ao identificador da entidade do evento'
  );

  if (event.event_type === 'task') {
    const parentTaskId = event.payload.parent_task_id;
    if (event.task_id === event.root_task_id) {
      assert.equal(parentTaskId, undefined, 'Tarefa raiz nao pode possuir parent_task_id');
    } else {
      assert.equal(typeof parentTaskId, 'string', 'Tarefa filha precisa informar parent_task_id');
      assert.ok(parentTaskId.trim().length > 0, 'parent_task_id nao pode ser vazio');
      assert.notEqual(parentTaskId, event.task_id, 'Tarefa nao pode ser pai de si mesma');
    }
  }

  if (event.recorded_at !== undefined) {
    assert.ok(
      isRfc3339Timestamp(event.recorded_at),
      'recorded_at precisa seguir RFC 3339 com timezone explicito'
    );
  }

  if (event.parent_event_ref !== undefined) {
    assert.ok(isObject(event.parent_event_ref), 'parent_event_ref precisa ser objeto');
    assert.ok(
      isUriReference(event.parent_event_ref.source),
      'parent_event_ref.source precisa ser URI-reference valida'
    );
    assert.equal(typeof event.parent_event_ref.event_id, 'string');
    assert.ok(event.parent_event_ref.event_id.trim().length > 0);
  }

  return true;
}
function validateTaskHierarchy(tasks) {
  const byId = new Map();

  for (const task of tasks) {
    assert.ok(task.task_id, 'task_id obrigatório');
    assert.ok(task.root_task_id, 'root_task_id obrigatório');
    assert.ok(!byId.has(task.task_id), `task_id duplicado: ${task.task_id}`);
    byId.set(task.task_id, task);
  }

  for (const task of tasks) {
    if (task.task_id === task.root_task_id) {
      assert.equal(task.parent_task_id ?? null, null, 'Tarefa raiz não pode ter pai');
      continue;
    }

    assert.ok(task.parent_task_id, `Tarefa filha ${task.task_id} precisa de parent_task_id`);
    const root = byId.get(task.root_task_id);
    assert.ok(root, `Tarefa raiz não encontrada para ${task.task_id}`);
    assert.equal(root.task_id, root.root_task_id, `Referência não aponta para uma tarefa raiz: ${task.task_id}`);
    assert.equal(root.parent_task_id ?? null, null, `Tarefa raiz não pode ter pai: ${task.root_task_id}`);

    const parent = byId.get(task.parent_task_id);
    assert.ok(parent, `Tarefa pai não encontrada para ${task.task_id}`);
    assert.equal(parent.root_task_id, task.root_task_id, `Pai pertence a outra raiz: ${task.task_id}`);
  }

  for (const task of tasks) {
    const visited = new Set();
    let current = task;
    while (current?.parent_task_id) {
      assert.ok(!visited.has(current.task_id), `Ciclo detectado na hierarquia da tarefa ${task.task_id}`);
      visited.add(current.task_id);
      current = byId.get(current.parent_task_id);
      assert.ok(current, `Tarefa pai não encontrada para ${task.task_id}`);
    }
  }
  return true;
}

function createVersionTracker() {
  const aggregates = new Map();
  const eventsById = new Map();

  function aggregateKey(event) {
    return JSON.stringify([event.source, event.aggregate.type, event.aggregate.id]);
  }

  function register(event) {
    validateEventEnvelope(event);
    const eventKey = JSON.stringify([event.source, event.event_id]);
    const existingEvent = eventsById.get(eventKey);
    if (existingEvent) {
      assert.deepEqual(existingEvent, event, 'Mesmo event_id recebido com conteúdo diferente');
      return 'duplicate';
    }

    const key = aggregateKey(event);
    const aggregate = aggregates.get(key) ?? {
      currentVersion: 0,
      versions: new Map(),
      pending: new Map()
    };
    const version = event.aggregate.version;

    assert.ok(!aggregate.versions.has(version), `Conflito: aggregate version ${version} já foi registrada`);
    assert.ok(!aggregate.pending.has(version), `Conflito: aggregate version ${version} já está pendente`);
    assert.ok(version > aggregate.currentVersion, 'Versão antiga ou inválida');

    const result = version > aggregate.currentVersion + 1 ? 'pending' : 'accepted';

    // Commit das estruturas somente depois de todas as validações.
    if (!aggregates.has(key)) aggregates.set(key, aggregate);
    eventsById.set(eventKey, structuredClone(event));

    if (result === 'pending') {
      aggregate.pending.set(version, structuredClone(event));
      return result;
    }

    aggregate.versions.set(version, structuredClone(event));
    aggregate.currentVersion = version;
    while (aggregate.pending.has(aggregate.currentVersion + 1)) {
      const nextVersion = aggregate.currentVersion + 1;
      const nextEvent = aggregate.pending.get(nextVersion);
      aggregate.pending.delete(nextVersion);
      aggregate.versions.set(nextVersion, nextEvent);
      aggregate.currentVersion = nextVersion;
    }
    return result;
  }

  return { register };
}

const eventFixtures = jsonBlocks.filter(
  (block) =>
    isObject(block) &&
    typeof block.event_type === 'string' &&
    Object.hasOwn(block, 'event_id')
);

test('documento do contrato existe e possui conteúdo', () => {
  assert.ok(fs.existsSync(contractPath));
  assert.ok(contract.length > 0);
});

test('documento contém exemplos JSON válidos', () => {
  assert.ok(jsonBlocks.length > 0);
});

test('documento apresenta os sete tipos de evento', () => {
  for (const type of eventTypes) {
    assert.ok(
      contract.includes(`\`${type}\``) ||
      contract.includes(`"${type}"`),
      `Tipo de evento não encontrado no documento: ${type}`
    );
  }
});

test('fixtures de eventos possuem envelope válido', () => {
  assert.ok(eventFixtures.length > 0);

  for (const event of eventFixtures) {
    validateEventEnvelope(event);
  }
});

test('eventos possuem versões iniciais válidas', () => {
  for (const event of eventFixtures) {
    assert.ok(event.aggregate.version >= 1);
  }
});

test('referências de eventos pais possuem estrutura válida', () => {
  for (const event of eventFixtures) {
    if (event.parent_event_ref) {
      assert.equal(typeof event.parent_event_ref.source, 'string');
      assert.equal(typeof event.parent_event_ref.event_id, 'string');
    }
  }
});

test('hierarquia de tarefas respeita raiz e pai', () => {
  const taskEvents = eventFixtures.filter(
    (event) => event.event_type === 'task'
  );

  const tasks = taskEvents.map((event) => ({
    task_id: event.task_id,
    root_task_id: event.root_task_id,
    parent_task_id: event.payload.parent_task_id ?? null
  }));

  if (tasks.length > 0) {
    assert.doesNotThrow(() => validateTaskHierarchy(tasks));
  }
});

test('tarefa raiz não pode possuir pai', () => {
  const tasks = [
    {
      task_id: 'root',
      root_task_id: 'root',
      parent_task_id: 'other'
    }
  ];

  assert.throws(
    () => validateTaskHierarchy(tasks),
    /Tarefa raiz não pode ter pai/
  );
});

test('tarefa filha precisa informar seu pai', () => {
  const tasks = [
    {
      task_id: 'root',
      root_task_id: 'root',
      parent_task_id: null
    },
    {
      task_id: 'child',
      root_task_id: 'root',
      parent_task_id: null
    }
  ];

  assert.throws(
    () => validateTaskHierarchy(tasks),
    /precisa de parent_task_id/
  );
});

test('hierarquia detecta referências a pais inexistentes', () => {
  const tasks = [
    {
      task_id: 'root',
      root_task_id: 'root',
      parent_task_id: null
    },
    {
      task_id: 'child',
      root_task_id: 'root',
      parent_task_id: 'missing'
    }
  ];

  assert.throws(
    () => validateTaskHierarchy(tasks),
    /Tarefa pai não encontrada/
  );
});

test('tracker aceita a primeira versão de um agregado', () => {
  const tracker = createVersionTracker();

  const event = {
    event_id: 'event-1',
    source: 'agente-s.example',
    event_type: 'task',
    schema_version: '1.0',
    occurred_at: '2026-11-04T10:00:00-03:00',
    task_id: 'task-1',
    root_task_id: 'task-1',
    aggregate: {
      type: 'task',
      id: 'task-1',
      version: 1
    },
    payload: {
      state: 'planned'
    }
  };

  assert.equal(tracker.register(event), 'accepted');
});

test('tracker identifica reentrega idêntica', () => {
  const tracker = createVersionTracker();

  const event = {
    event_id: 'event-1',
    source: 'agente-s.example',
    event_type: 'task',
    schema_version: '1.0',
    occurred_at: '2026-11-04T10:00:00-03:00',
    task_id: 'task-1',
    root_task_id: 'task-1',
    aggregate: {
      type: 'task',
      id: 'task-1',
      version: 1
    },
    payload: {
      state: 'planned'
    }
  };

  assert.equal(tracker.register(event), 'accepted');
  assert.equal(tracker.register(event), 'duplicate');
});

test('tracker rejeita reentrega com mesmo ID e conteúdo diferente', () => {
  const tracker = createVersionTracker();

  const event = {
    event_id: 'event-1',
    source: 'agente-s.example',
    event_type: 'task',
    schema_version: '1.0',
    occurred_at: '2026-11-04T10:00:00-03:00',
    task_id: 'task-1',
    root_task_id: 'task-1',
    aggregate: {
      type: 'task',
      id: 'task-1',
      version: 1
    },
    payload: {
      state: 'planned'
    }
  };

  tracker.register(event);

  const changed = structuredClone(event);
  changed.payload.state = 'queued';

  assert.throws(
    () => tracker.register(changed),
    /conteúdo diferente/
  );
});

test('tracker mantém versão recebida fora de ordem como pendente', () => {
  const tracker = createVersionTracker();

  const eventV2 = {
    event_id: 'event-2',
    source: 'agente-s.example',
    event_type: 'task',
    schema_version: '1.0',
    occurred_at: '2026-11-04T10:02:00-03:00',
    task_id: 'task-1',
    root_task_id: 'task-1',
    aggregate: {
      type: 'task',
      id: 'task-1',
      version: 2
    },
    payload: {
      state: 'queued'
    }
  };

  const eventV1 = {
    ...eventV2,
    event_id: 'event-1',
    occurred_at: '2026-11-04T10:00:00-03:00',
    aggregate: {
      ...eventV2.aggregate,
      version: 1
    },
    payload: {
      state: 'planned'
    }
  };

  assert.equal(tracker.register(eventV2), 'pending');
  assert.equal(tracker.register(eventV1), 'accepted');
});

test('tracker rejeita conflito de versão no mesmo agregado', () => {
  const tracker = createVersionTracker();

  const base = {
    event_id: 'event-1',
    source: 'agente-s.example',
    event_type: 'task',
    schema_version: '1.0',
    occurred_at: '2026-11-04T10:00:00-03:00',
    task_id: 'task-1',
    root_task_id: 'task-1',
    aggregate: {
      type: 'task',
      id: 'task-1',
      version: 1
    },
    payload: {
      state: 'planned'
    }
  };

  tracker.register(base);

  const conflict = {
    ...base,
    event_id: 'event-2',
    payload: {
      state: 'queued'
    }
  };

  assert.throws(
    () => tracker.register(conflict),
    /já foi registrada/
  );
});

test('transições de estado documentadas aparecem no contrato', () => {
  const expectedStates = [
    'planned',
    'queued',
    'running',
    'completed',
    'failed',
    'cancelled',
    'available',
    'superseded',
    'accepted',
    'rejected',
    'blocked',
    'open',
    'resolved'
  ];

  for (const state of expectedStates) {
    assert.ok(
      contract.includes(`\`${state}\``) ||
      contract.includes(`"${state}"`),
      `Estado não encontrado no documento: ${state}`
    );
  }
});

test('contrato documenta deduplicação por source e event_id', () => {
  assert.ok(contract.includes('event_id'));
  assert.ok(contract.includes('source'));
  assert.match(contract, /dedup|idempot/i);
});

test('contrato documenta aggregate.version', () => {
  assert.match(contract, /aggregate\.version/);
});

test('contrato documenta task_id, root_task_id e parent_task_id', () => {
  assert.ok(contract.includes('task_id'));
  assert.ok(contract.includes('root_task_id'));
  assert.ok(contract.includes('parent_task_id'));
});


test('timestamp exige RFC 3339 com timezone explícito', () => {
  const base = structuredClone(eventFixtures.find((event) => event.event_type === 'task'));
  assert.ok(base, 'fixture task necessária');
  for (const invalid of ['2026-11-04T10:00:00', '04/11/2026 10:00:00', '2026-13-04T10:00:00Z']) {
    const candidate = { ...base, occurred_at: invalid };
    assert.throws(() => validateEventEnvelope(candidate), /RFC 3339/);
  }
  assert.doesNotThrow(() => validateEventEnvelope(base));
});

test('hierarquia rejeita raiz inexistente e pai de outra raiz', () => {
  assert.throws(() => validateTaskHierarchy([
    { task_id: 'child', root_task_id: 'missing-root', parent_task_id: 'parent' },
    { task_id: 'parent', root_task_id: 'missing-root', parent_task_id: null }
  ]), /Tarefa raiz não encontrada|Referência não aponta/);
  assert.throws(() => validateTaskHierarchy([
    { task_id: 'root-a', root_task_id: 'root-a', parent_task_id: null },
    { task_id: 'root-b', root_task_id: 'root-b', parent_task_id: null },
    { task_id: 'child', root_task_id: 'root-a', parent_task_id: 'root-b' }
  ]), /Pai pertence a outra raiz/);
});

test('tracker não registra evento rejeitado por conflito de versão', () => {
  const tracker = createVersionTracker();
  const base = structuredClone(eventFixtures.find((event) => event.event_type === 'task'));
  assert.ok(base);
  base.event_id = 'regression-v1';
  base.aggregate.version = 1;
  assert.equal(tracker.register(base), 'accepted');
  const conflict = { ...structuredClone(base), event_id: 'regression-conflict', aggregate: { ...base.aggregate, version: 1 } };
  assert.throws(() => tracker.register(conflict), /já foi registrada/);
  assert.throws(() => tracker.register(conflict), /já foi registrada/);
});

test('chaves do tracker não colidem quando IDs contêm separador', () => {
  const tracker = createVersionTracker();
  const base = structuredClone(eventFixtures.find((event) => event.event_type === 'task'));
  assert.ok(base);
  const first = { ...structuredClone(base), source: 'a:b', event_id: 'c', task_id: 'x:y', root_task_id: 'x:y', aggregate: { ...base.aggregate, id: 'x:y' } };
  const second = { ...structuredClone(base), source: 'a', event_id: 'b:c', task_id: 'y', root_task_id: 'y', aggregate: { ...base.aggregate, id: 'y' } };
  assert.equal(tracker.register(first), 'accepted');
  assert.equal(tracker.register(second), 'accepted');
});

test('source precisa ser URI-reference valida', () => {
  const base = structuredClone(eventFixtures.find((event) => event.event_type === 'task'));
  assert.ok(base);
  for (const source of ['', '   ', 'invalid source with spaces']) {
    assert.throws(() => validateEventEnvelope({ ...base, source }), /source precisa ser/);
  }
  assert.doesNotThrow(() => validateEventEnvelope({ ...base, source: 'agente-s.example' }));
});

test('schema_version aceita somente a versao inicial documentada', () => {
  const base = structuredClone(eventFixtures.find((event) => event.event_type === 'task'));
  assert.ok(base);
  assert.throws(
    () => validateEventEnvelope({ ...base, schema_version: '1.0.0' }),
    /schema_version nao suportada/
  );
});

test('identificadores de tarefa nao podem ser vazios', () => {
  const base = structuredClone(eventFixtures.find((event) => event.event_type === 'task'));
  assert.ok(base);
  assert.throws(() => validateEventEnvelope({ ...base, task_id: '' }), /task_id nao pode ser vazio/);
  assert.throws(() => validateEventEnvelope({ ...base, root_task_id: '' }), /root_task_id nao pode ser vazio/);
});

test('aggregate.type e aggregate.id devem corresponder ao evento', () => {
  const base = structuredClone(eventFixtures.find((event) => event.event_type === 'task'));
  assert.ok(base);
  assert.throws(
    () => validateEventEnvelope({ ...base, aggregate: { ...base.aggregate, type: 'result' } }),
    /aggregate.type deve corresponder/
  );
  assert.throws(
    () => validateEventEnvelope({ ...base, aggregate: { ...base.aggregate, id: 'other-task' } }),
    /aggregate.id deve corresponder/
  );
});