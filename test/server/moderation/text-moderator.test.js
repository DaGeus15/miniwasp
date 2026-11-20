import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODERATION_REASONS,
  ModerationCategory,
  TextModerator,
  moderationReason,
} from '../../../src/server/moderation/text-moderator.js';

const moderator = new TextModerator();
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const {
  SEXUAL_EXPLICIT,
  MINORS_SEXUAL,
  DRUG_SALES,
  WEAPON_SALES,
  VIOLENT_THREAT,
  HATE,
} = ModerationCategory;

function assertBlocked(text, category) {
  assert.deepEqual(moderator.review(text), { allowed: false, category }, text);
}

function assertAllowed(text) {
  assert.deepEqual(moderator.review(text), { allowed: true }, text);
}

describe('TextModerator: cada categoria en espanol e ingles', () => {
  const cases = [
    [SEXUAL_EXPLICIT, ['mira este porno', 'pasame el pack', 'send nudes', 'free hentai here']],
    [MINORS_SEXUAL, ['pornografia infantil', 'tengo fotos de niñas desnudas', 'teen porn']],
    [DRUG_SALES, ['vendo marihuana barata', 'delivery de pasta base', 'selling weed, dm me']],
    [WEAPON_SALES, ['vendo pistolas y municiones', 'se vende un arma', 'buy a glock cheap']],
    [VIOLENT_THREAT, ['te voy a matar', 'te voy a dar matando', 'I will kill you', 'kys']],
    [HATE, ['muerte a los judios', 'malditos venecos', 'kill all jews', 'heil hitler']],
  ];
  for (const [category, texts] of cases) {
    it(`bloquea ${category}`, () => {
      for (const text of texts) {
        assertBlocked(text, category);
      }
    });
  }
});

describe('TextModerator: evasiones', () => {
  it('detecta leetspeak, mayusculas y acentos', () => {
    assertBlocked('P0RN0 GR4T1S', SEXUAL_EXPLICIT);
    assertBlocked('v3nd0 c0c41n4', DRUG_SALES);
    assertBlocked('PORNOGRAFÍA', SEXUAL_EXPLICIT);
  });

  it('detecta separadores, espacios y caracteres invisibles', () => {
    assertBlocked('p.o.r.n.o', SEXUAL_EXPLICIT);
    assertBlocked('p o r n o', SEXUAL_EXPLICIT);
    assertBlocked(`por${ZERO_WIDTH_SPACE}no`, SEXUAL_EXPLICIT);
    assertBlocked('p-o-r-n-o-g-r-a-f-i-a', SEXUAL_EXPLICIT);
  });

  it('detecta letras repetidas', () => {
    assertBlocked('poooorrrnoooo', SEXUAL_EXPLICIT);
    assertBlocked('te voy a mataaaar', VIOLENT_THREAT);
  });

  it('detecta prefijos de palabras', () => {
    assertBlocked('contenido pornografico', SEXUAL_EXPLICIT);
    assertBlocked('quiero masturbarme', SEXUAL_EXPLICIT);
  });

  it('detecta terminos con digitos y frases numericas', () => {
    assertBlocked('vendo ak47', WEAPON_SALES);
    assertBlocked('sell 9mm ammo', WEAPON_SALES);
    assertBlocked('somos 14 88', HATE);
  });
});

describe('TextModerator: falsos positivos que deben pasar', () => {
  it('no bloquea palabras que contienen terminos (problema de Scunthorpe)', () => {
    for (const text of ['análisis de datos', 'Scunthorpe', 'sexto grado', 'por nosotros', 'cocaleros']) {
      assertAllowed(text);
    }
  });

  it('permite la groseria comun', () => {
    const profanity = [
      'qué mierda, chucha', 'hijo de puta', 'vale verga', 'fuck this shit', 'fuck you',
      'no seas pendejo', 'joder, carajo', 'puta madre, se cayo el wifi',
    ];
    for (const text of profanity) {
      assertAllowed(text);
    }
  });

  // Decision: el modismo "matar de risa/a besos" pasa; "te voy a matar" solo se bloquea.
  it('permite modismos con "matar" pero no la amenaza directa', () => {
    assertAllowed('te voy a matar de risa');
    assertAllowed('te mato a besos');
    assertAllowed('vamos a matar el tiempo');
    assertBlocked('te mato', VIOLENT_THREAT);
  });

  it('permite objetos que comparten palabra con drogas o armas', () => {
    assertAllowed('vendo coca cola helada');
    assertAllowed('se vende pistola de agua');
    assertAllowed('vendo pistola de silicona');
    assertAllowed('buy a coke');
    assertAllowed('vendo un c4 2015');
  });

  it('no confunde menciones neutrales de sexo o menores', () => {
    assertAllowed('ya saben el sexo del bebe');
    assertAllowed('educacion sexual para niños');
    assertAllowed('el menor precio en ropa sexy');
    assertAllowed('el carro negro de mierda');
    assertAllowed('labial nude para niña');
  });

  it('una droga o arma sin intencion de venta no se bloquea', () => {
    assertAllowed('la marihuana es ilegal aqui');
    assertAllowed('vi una pelicula de pistolas');
  });
});

describe('TextModerator: coocurrencia', () => {
  it('menor mas termino sexual es contenido con menores', () => {
    assertBlocked('niña sexy', MINORS_SEXUAL);
    assertBlocked('busco menor de edad para sexo con ella', MINORS_SEXUAL);
    assertBlocked('kids naked', MINORS_SEXUAL);
  });

  it('una edad menor de 18 cuenta como menor y 18 ya no', () => {
    assertBlocked('tengo 15 años y soy sexy', MINORS_SEXUAL);
    assertBlocked('chica de 17 años desnuda', MINORS_SEXUAL);
    assertBlocked('12 añitos sexy', MINORS_SEXUAL);
    assertBlocked('13yo nudes', MINORS_SEXUAL);
    assertBlocked('14 years old naked', MINORS_SEXUAL);
    assertBlocked('16 años de edad cachonda', MINORS_SEXUAL);
    assertAllowed('tengo 18 años y soy sexy');
    assertAllowed('tengo 25 años y soy sexy');
  });

  it('una edad sin contexto sexual o una duracion no cuentan como menor', () => {
    assertAllowed('tengo 15 años y me gusta el futbol');
    assertBlocked('hace 10 años vi porno', SEXUAL_EXPLICIT);
  });

  it('venta mas droga o arma bloquea; cada parte sola no', () => {
    assertBlocked('compro mota', DRUG_SALES);
    assertBlocked('precio de la cocaina por gramo', DRUG_SALES);
    assertAllowed('vendo zapatos');
    assertBlocked('venta de rifles', WEAPON_SALES);
  });

  it('el contenido con menores tiene prioridad sobre otras categorias', () => {
    assertBlocked('vendo porno de niñas', MINORS_SEXUAL);
    assertBlocked('te voy a matar, vendo porno infantil', MINORS_SEXUAL);
  });
});

describe('TextModerator: entradas y configuracion', () => {
  it('permite texto vacio o que no es texto', () => {
    for (const value of ['', '   ', null, undefined, 42, {}]) {
      assert.deepEqual(moderator.review(value), { allowed: true });
    }
  });

  it('es determinista y devuelve decisiones inmutables', () => {
    const first = moderator.review('mira este porno');

    assert.deepEqual(moderator.review('mira este porno'), first);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(moderator.review('hola')));
  });

  it('acepta reglas propias y aun asi evalua primero las de menores', () => {
    const custom = new TextModerator({
      rules: [
        { category: HATE, all: [{ words: ['alfa'] }] },
        { category: MINORS_SEXUAL, all: [{ phrases: ['beta gama'] }] },
        { category: DRUG_SALES, all: [{ compact: ['deltaepsilon'] }] },
      ],
      exemptPhrases: ['alfa romeo'],
    });

    assert.deepEqual(custom.review('alfa beta gama'), { allowed: false, category: MINORS_SEXUAL });
    assert.deepEqual(custom.review('alfa'), { allowed: false, category: HATE });
    assert.deepEqual(custom.review('d.e.l.t.a e.p.s.i.l.o.n'), { allowed: false, category: DRUG_SALES });
    assert.deepEqual(custom.review('mi alfa romeo'), { allowed: true });
  });
});

describe('ModerationCategory y motivos', () => {
  it('la enumeracion es inmutable y cada categoria tiene un motivo en espanol', () => {
    assert.ok(Object.isFrozen(ModerationCategory));
    assert.ok(Object.isFrozen(MODERATION_REASONS));
    assert.deepEqual(Object.keys(MODERATION_REASONS).sort(), Object.values(ModerationCategory).sort());
    assert.equal(moderationReason(SEXUAL_EXPLICIT), 'parece contener contenido sexual explícito');
    assert.equal(moderationReason(MINORS_SEXUAL), 'parece contener contenido sexual que involucra a menores');
    assert.equal(moderationReason(DRUG_SALES), 'parece ofrecer la venta de drogas');
    assert.equal(moderationReason(WEAPON_SALES), 'parece ofrecer la venta de armas');
    assert.equal(moderationReason(VIOLENT_THREAT), 'parece contener una amenaza violenta');
    assert.equal(moderationReason(HATE), 'parece contener discurso de odio');
  });

  it('una categoria desconocida recibe un motivo generico', () => {
    assert.equal(moderationReason('OTRA'), 'parece infringir las normas de la sala');
    assert.equal(moderationReason('toString'), 'parece infringir las normas de la sala');
  });
});
