
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EVENT_TYPES,
  createVersionTracker,
  isObject,
  validateEventEnvelope,
  validateTaskHierarchy
} from '../packages/contracts/src/index.ts';

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

// Validadores do contrato: implementação única em packages/contracts (TypeScript
// executado diretamente pelo Node 24). Este teste confere o documento e as regras.
const eventTypes = [...EVENT_TYPES];

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