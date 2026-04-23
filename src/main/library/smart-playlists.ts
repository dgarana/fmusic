import type {
  SmartPlaylistDefinition,
  SmartPlaylistField,
  SmartPlaylistRule
} from '../../shared/types.js';

interface CompiledSmartPlaylist {
  sql: string;
  params: Record<string, unknown>;
}

const TEXT_FIELDS: SmartPlaylistField[] = ['title', 'artist', 'album', 'genre'];

function isTextField(field: SmartPlaylistField): field is 'title' | 'artist' | 'album' | 'genre' {
  return TEXT_FIELDS.includes(field);
}

function compileRule(
  rule: SmartPlaylistRule,
  index: number,
  trackAlias: string
): CompiledSmartPlaylist {
  const field = `${trackAlias}.${rule.field}`;
  const baseKey = `smart_${index}`;

  if (!isTextField(rule.field)) {
    throw new Error(`Smart playlist field "${rule.field}" is not supported yet.`);
  }

  if (rule.operator === 'contains' && rule.value.kind === 'text') {
    return {
      sql: `${field} LIKE @${baseKey}`,
      params: { [baseKey]: `%${rule.value.value}%` }
    };
  }

  if (rule.operator === 'is' && rule.value.kind === 'text') {
    return {
      sql: `${field} = @${baseKey}`,
      params: { [baseKey]: rule.value.value }
    };
  }

  if (rule.operator === 'isAnyOf' && rule.value.kind === 'text-list') {
    if (rule.value.values.length === 0) {
      return { sql: '0=1', params: {} };
    }
    const placeholders = rule.value.values.map((_, valueIndex) => `@${baseKey}_${valueIndex}`);
    const params = Object.fromEntries(
      rule.value.values.map((value, valueIndex) => [`${baseKey}_${valueIndex}`, value])
    );
    return {
      sql: `${field} IN (${placeholders.join(', ')})`,
      params
    };
  }

  throw new Error(
    `Smart playlist operator "${rule.operator}" is not supported for field "${rule.field}".`
  );
}

export function compileSmartPlaylistDefinition(
  definition: SmartPlaylistDefinition,
  trackAlias = 't'
): CompiledSmartPlaylist {
  if (!definition.rules.length) {
    return { sql: '0=1', params: {} };
  }

  const glue = definition.match === 'any' ? ' OR ' : ' AND ';
  const compiledRules = definition.rules.map((rule, index) => compileRule(rule, index, trackAlias));
  return {
    sql: compiledRules.map((rule) => `(${rule.sql})`).join(glue),
    params: Object.assign({}, ...compiledRules.map((rule) => rule.params))
  };
}
