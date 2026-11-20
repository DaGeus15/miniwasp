import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ModerationCategory,
  ModerationLevel,
  TextModerator,
  moderationReason,
} from '../../../src/server/moderation/text-moderator.js';

const moderator = new TextModerator();
const { PROFANITY, INSULT, MINORS_SEXUAL, SEXUAL_EXPLICIT, VIOLENT_THREAT, HATE } = ModerationCategory;
const STRICT = { level: ModerationLevel.STRICT };
const STANDARD = { level: ModerationLevel.STANDARD };

function assertStrict(text, category) {
  assert.deepEqual(moderator.review(text, STRICT), { allowed: false, category }, text);
}

function assertAllowedInStrict(text) {
  assert.deepEqual(moderator.review(text, STRICT), { allowed: true }, text);
}

const PROFANITY_SAMPLES = [
  'qué mierda', 'chucha, se fue la luz', 'hijo de puta', 'vale verga', 'no seas pendejo',
  'ese cabrón', 'carajo', 'joder', 'qué coño', 'de putamadre', 'me cago en todo', 'ctm',
  'fuck this shit', 'what the fuck', 'son of a bitch', 'damn it', 'bullshit', 'wtf',
];
const INSULT_SAMPLES = [
  'idiota', 'eres un estúpido', 'imbécil', 'tarado', 'eres una tonta', 'eres un retrasado',
  'retrasado mental', 'cojudo', 'que burro eres', 'you are a loser', 'you idiot', 'stupid',
  'moron', 'dumbass',
];

describe('TextModerator: nivel estandar', () => {
  it('es el nivel por defecto y permite groserias e insultos como antes', () => {
    for (const text of [...PROFANITY_SAMPLES, ...INSULT_SAMPLES]) {
      assert.deepEqual(moderator.review(text), { allowed: true }, text);
      assert.deepEqual(moderator.review(text, STANDARD), { allowed: true }, text);
      assert.deepEqual(moderator.review(text, {}), { allowed: true }, text);
    }
  });

  it('sigue bloqueando lo grave con la misma categoria', () => {
    assert.deepEqual(moderator.review('mira este porno', STANDARD), {
      allowed: false,
      category: SEXUAL_EXPLICIT,
    });
  });
});

describe('TextModerator: nivel estricto', () => {
  it('bloquea groserias en espanol e ingles', () => {
    for (const text of PROFANITY_SAMPLES) {
      assertStrict(text, PROFANITY);
    }
  });

  it('bloquea insultos dirigidos en espanol e ingles', () => {
    for (const text of INSULT_SAMPLES) {
      assertStrict(text, INSULT);
    }
  });

  it('detecta evasiones con leetspeak, separadores, repeticiones y mayusculas', () => {
    assertStrict('m1erd4', PROFANITY);
    assertStrict('p.u.t.a', PROFANITY);
    assertStrict('m i e r d a', PROFANITY);
    assertStrict('MIERDAAAA', PROFANITY);
    assertStrict('sh1t', PROFANITY);
    assertStrict('1d10t4', INSULT);
    assertStrict('ESTÚPIDO', INSULT);
    assertStrict('i-d-i-o-t-a', INSULT);
  });

  it('un nivel desconocido se trata como estricto', () => {
    assert.deepEqual(moderator.review('mierda', { level: 'otro' }), {
      allowed: false,
      category: PROFANITY,
    });
  });
});

describe('TextModerator: falsos positivos en nivel estricto', () => {
  it('no confunde palabras que contienen una groseria', () => {
    const innocent = [
      'mi computadora nueva', 'una disputa legal', 'cuida tu reputación', 'un carajillo, por favor',
      'un cono de helado', 'viajamos a Puyo', 'qué vergüenza', 'su padre putativo', 'Scunthorpe',
      'un shih tzu', 'una clase de historia', 'el vuelo está retrasado', 'mi laptop hp',
      'huevos revueltos', 'tengo un burro en la finca', 'la perra tuvo cachorros',
    ];
    for (const text of innocent) {
      assertAllowedInStrict(text);
    }
  });

  it('permite eufemismos y mensajes educados', () => {
    for (const text of ['chuta, se me olvido', 'caramba', 'diablos', 'rayos', 'hola a todos']) {
      assertAllowedInStrict(text);
    }
  });

  it('el texto vacio o que no es texto sigue permitido', () => {
    assert.deepEqual(moderator.review('', STRICT), { allowed: true });
    assert.deepEqual(moderator.review(null, STRICT), { allowed: true });
  });
});

describe('TextModerator: prioridad entre categorias', () => {
  it('lo grave gana sobre groserias e insultos', () => {
    assertStrict('puta, vendo porno infantil', MINORS_SEXUAL);
    assertStrict('idiota, mira este porno', SEXUAL_EXPLICIT);
    assertStrict('te voy a matar, imbécil', VIOLENT_THREAT);
    assertStrict('negros de mierda', HATE);
  });

  it('un insulto dirigido gana sobre una groseria', () => {
    assertStrict('eres un idiota de mierda', INSULT);
  });

  it('las reglas estrictas propias se ordenan despues de las graves', () => {
    const custom = new TextModerator({
      rules: [
        { category: PROFANITY, level: ModerationLevel.STRICT, all: [{ words: ['alfa'] }] },
        { category: HATE, all: [{ words: ['beta'] }] },
        { category: MINORS_SEXUAL, all: [{ words: ['gama'] }] },
      ],
      exemptPhrases: [],
    });

    assert.deepEqual(custom.review('alfa beta', STRICT), { allowed: false, category: HATE });
    assert.deepEqual(custom.review('alfa beta gama', STRICT), { allowed: false, category: MINORS_SEXUAL });
    assert.deepEqual(custom.review('alfa', STRICT), { allowed: false, category: PROFANITY });
    assert.deepEqual(custom.review('alfa'), { allowed: true });
  });
});

describe('Motivos del nivel estricto', () => {
  it('explican groserias e insultos con acentos correctos', () => {
    assert.equal(moderationReason(PROFANITY), 'parece contener groserías');
    assert.equal(moderationReason(INSULT), 'parece contener insultos');
  });

  it('los niveles forman una enumeracion inmutable', () => {
    assert.ok(Object.isFrozen(ModerationLevel));
    assert.deepEqual(ModerationLevel, { STANDARD: 'standard', STRICT: 'strict' });
  });
});
