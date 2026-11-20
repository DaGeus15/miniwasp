// Diccionario de moderacion (espanol latinoamericano/ecuatoriano e ingles). Solo datos.
//
// Cada grupo de terminos admite:
// - words: palabras sueltas; un "*" final indica prefijo ("pornograf*").
// - phrases: secuencias de palabras ya normalizadas.
// - compact: terminos largos e inequivocos que tambien se buscan con todo el texto junto
//   ("p.o.r.n.o.g.r.a.f.i.a"); nunca terminos cortos, para no caer en el problema de Scunthorpe.
// - minorAgePatterns: expresiones con un grupo "age" que senalan una edad menor de 18.
//
// La grosería comun ("mierda", "chucha", "verga", "fuck") y los insultos solo se bloquean en el
// nivel estricto (salas publicas, aptas para todo publico); en el nivel estandar se permiten.
// Los terminos ambiguos solo cuentan en coocurrencia
// (por ejemplo "coca" necesita "vendo" y "pistola" pierde valor en "pistola de agua").

export const ModerationCategory = Object.freeze({
  SEXUAL_EXPLICIT: 'SEXUAL_EXPLICIT',
  MINORS_SEXUAL: 'MINORS_SEXUAL',
  DRUG_SALES: 'DRUG_SALES',
  WEAPON_SALES: 'WEAPON_SALES',
  VIOLENT_THREAT: 'VIOLENT_THREAT',
  HATE: 'HATE',
  PROFANITY: 'PROFANITY',
  INSULT: 'INSULT',
});

// Estandar: solo contenido grave. Estricto: ademas groserias e insultos.
export const ModerationLevel = Object.freeze({ STANDARD: 'standard', STRICT: 'strict' });

function freezeGroup({ words = [], phrases = [], compact = [], minorAgePatterns = [] }) {
  return Object.freeze({
    words: Object.freeze(words),
    phrases: Object.freeze(phrases),
    compact: Object.freeze(compact),
    minorAgePatterns: Object.freeze(minorAgePatterns),
  });
}

function expandTemplates(templates, fillers) {
  return templates.flatMap((template) => fillers.map((filler) => template.replace('{g}', filler)));
}

// Frases inocentes que se retiran antes de comparar: modismos y objetos que comparten palabra.
export const EXEMPT_PHRASES = Object.freeze([
  'matar de risa', 'matarte de risa', 'mato de risa', 'matar a besos', 'matarte a besos',
  'mato a besos', 'matar a cosquillas', 'matarte a cosquillas', 'mato a cosquillas',
  'matar el tiempo', 'matar el hambre', 'matar la sed', 'matar dos pajaros',
  'kill time', 'killing time', 'killing it', 'kill it',
  'coca cola', 'cocacola', 'hoja de coca', 'hierba buena',
  'pistola de agua', 'pistolas de agua', 'pistola de juguete', 'pistolas de juguete',
  'pistola de silicona', 'pistola de calor', 'pistola de pintura', 'arma de juguete',
  'armas de juguete', 'water gun', 'water guns', 'toy gun', 'toy guns', 'glue gun', 'nerf gun',
]);

const SEXUAL_EXPLICIT_TERMS = freezeGroup({
  words: [
    'porno', 'pornos', 'porn', 'porns', 'pornograf*', 'pornhub', 'xvideos', 'xnxx', 'xhamster',
    'onlyfans', 'hentai', 'mamada', 'mamadas', 'felacion', 'cunnilingus', 'masturbar*',
    'masturbacion', 'masturbate', 'masturbating', 'culear', 'culearte', 'culiar', 'culiarte',
    'follarte', 'follarme', 'chupamela', 'mamamela', 'metertela', 'blowjob', 'blowjobs',
    'handjob', 'cumshot', 'creampie', 'gangbang', 'dildo', 'dildos',
  ],
  phrases: [
    'sexo oral', 'sexo anal', 'sexo explicito', 'sexo por dinero', 'sexo a domicilio',
    'servicios sexuales', 'chicas prepago', 'hacerse una paja', 'hacerte una paja',
    'hacerme una paja', 'me hice una paja', 'te la meto', 'chupame la verga', 'mamame la verga',
    'quiero follarte', 'quiero cogerte', 'te quiero coger', 'te quiero culear', 'manda nudes',
    'mandame nudes', 'pasa nudes', 'pasame nudes', 'pasa el pack', 'pasame el pack',
    'pasa tu pack', 'vendo pack', 'vendo mi pack', 'fotos desnuda', 'fotos desnudo',
    'foto desnuda', 'muestrame las tetas', 'ensename las tetas', 'send nudes', 'oral sex',
    'anal sex', 'jerk off', 'jack off', 'suck my dick', 'suck my cock', 'show me your tits',
    'want to fuck you', 'wanna fuck you',
  ],
  compact: [
    'pornografia', 'pornografico', 'pornhub', 'xvideos', 'onlyfans', 'masturbacion',
    'gangbang', 'blowjob', 'cumshot', 'creampie',
  ],
});

// Por si solos ya describen abuso sexual infantil.
const MINORS_DIRECT_TERMS = freezeGroup({
  words: ['lolicon', 'shotacon', 'jailbait', 'pedoporn*', 'pthc', 'childporn'],
  phrases: [
    'pornografia infantil', 'porno infantil', 'porno de ninas', 'porno de niñas',
    'porno de ninos', 'porno de niños', 'child porn', 'child pornography', 'kiddie porn',
  ],
  compact: ['pornografiainfantil', 'pornoinfantil', 'childporn', 'pedopornografia'],
});

// "nena", "chiquilla" o "Nina" quedan fuera: se usan con adultos o son nombres propios.
const MINOR_REFERENCES = freezeGroup({
  words: [
    'niña', 'niñas', 'ninas', 'niño', 'nino', 'niños', 'ninos', 'menores', 'colegiala',
    'colegialas', 'loli', 'lolis', 'teen', 'teens', 'teenager', 'teenagers', 'preteen',
    'preteens', 'kid', 'kids', 'child', 'children', 'minors', 'underage', 'schoolgirl',
    'schoolgirls',
  ],
  // "menor" y "minor" solos son comparativos ("menor precio", "minor issue").
  phrases: ['menor de edad', 'una menor', 'un menor', 'a minor'],
  minorAgePatterns: [
    /(?:^| )(?:tengo|tiene|tienes|tenia|cumple|cumplio) (?<age>\d{1,2}) (?:años|anos)(?= |$)/g,
    /(?:^| )(?:chica|chico|chicas|chicos|niña|niño|jovencita|jovencito|girl|boy) de (?<age>\d{1,2}) (?:años|anos)(?= |$)/g,
    /(?:^| )(?<age>\d{1,2}) ?(?:añitos|anitos)(?= |$)/g,
    /(?:^| )(?<age>\d{1,2}) (?:años|anos) de edad(?= |$)/g,
    /(?:^| )(?<age>\d{1,2}) ?(?:yo|y o)(?= |$)/g,
    /(?:^| )(?<age>\d{1,2}) ?(?:years?|yrs?) old(?= |$)/g,
  ],
});

// Lo sexual que, junto a un menor, ya es inaceptable. "sexo" o "sexual" solos no cuentan
// ("el sexo del bebe", "educacion sexual para ninos").
const SEXUAL_REFERENCES = freezeGroup({
  words: [
    ...SEXUAL_EXPLICIT_TERMS.words, 'sexy', 'sensual', 'erotica', 'erotico', 'eroticas',
    'eroticos', 'erotic', 'desnuda', 'desnudo', 'desnudas', 'desnudos', 'naked', 'cachonda',
    'cachondo', 'horny', 'porno*', 'nudes',
  ],
  phrases: [
    ...SEXUAL_EXPLICIT_TERMS.phrases, 'sexo con', 'tener sexo', 'hacer el amor', 'have sex',
    'sex with', 'fotos intimas',
  ],
  compact: SEXUAL_EXPLICIT_TERMS.compact,
});

const SALE_REFERENCES = freezeGroup({
  words: [
    'vendo', 'vende', 'venden', 'vendes', 'vendemos', 'vender', 'venta', 'ventas', 'compro',
    'comprar', 'distribuyo', 'distribuimos', 'precio', 'precios', 'delivery', 'envios',
    'gramo', 'gramos', 'sell', 'selling', 'buy', 'buying', 'price',
  ],
  // "sale" (de salir) y "domicilio" solos son demasiado comunes en espanol.
  phrases: ['para la venta', 'a domicilio', 'for sale', 'hit me up', 'dm me'],
});

const DRUG_REFERENCES = freezeGroup({
  words: [
    'marihuana', 'marijuana', 'mariguana', 'mota', 'weed', 'cannabis', 'cocaina', 'coca',
    'cocaine', 'heroina', 'heroin', 'fentanilo', 'fentanyl', 'meth', 'metanfetamina',
    'extasis', 'ecstasy', 'mdma', 'lsd', 'tusi', 'tussi', 'tucibi', '2cb', 'ketamina',
    'ketamine', 'keta', 'bazuco', 'basuco', 'xanax', 'oxycodone', 'opio', 'opium', 'hachis',
    'hashish', 'dmt', 'psilocibina', 'shrooms',
  ],
  // "coke", "crack", "molly" u "oxy" tienen usos cotidianos; solo cuentan en frases claras.
  phrases: [
    'pasta base', 'hongos magicos', 'magic mushrooms', 'crystal meth', 'crack cocaine',
    'polvo de angel',
  ],
  compact: ['metanfetamina', 'marihuana', 'fentanilo', 'cocaina'],
});

const WEAPON_REFERENCES = freezeGroup({
  words: [
    'pistola', 'pistolas', 'revolveres', 'armas', 'fusil', 'fusiles', 'rifle', 'rifles',
    'escopeta', 'escopetas', 'ametralladora', 'subametralladora', 'municion', 'municiones',
    'balas', 'explosivos', 'dinamita', 'glock', 'beretta', 'uzi', 'ak47', 'ar15', '9mm', 'mp5',
    'gun', 'guns', 'pistol', 'pistols', 'shotgun',
    'shotguns', 'ammo', 'ammunition', 'firearm', 'firearms', 'handgun', 'handguns',
    'explosives', 'grenade', 'grenades',
  ],
  // "arma" y "revolver" tambien son verbos (armar, revolver); "c4" es un modelo de auto.
  phrases: [
    'un arma', 'una arma', 'el arma', 'arma de fuego', 'armas de fuego', 'granada de mano',
    'assault rifle',
  ],
});

const VIOLENT_THREAT_TERMS = freezeGroup({
  words: [
    'matarte', 'asesinarte', 'dispararte', 'apuñalarte', 'acuchillarte', 'degollarte',
    'descuartizarte', 'balearte', 'acribillarte', 'violarte', 'suicidate', 'kys',
  ],
  phrases: [
    'te voy a matar', 'te mato', 'los voy a matar', 'las voy a matar', 'lo voy a matar',
    'la voy a matar', 'te voy a disparar', 'te voy a quemar', 'quemarte vivo', 'quemarte viva',
    'te voy a quebrar', 'te voy a desaparecer', 'te meto un tiro', 'te pego un tiro',
    'te voy a meter bala', 'te voy a dar bala', 'darte bala', 'meterte bala',
    'te voy a dar un balazo', 'te voy a dar matando', 'te doy matando', 'te voy a violar',
    'voy a poner una bomba', 'poner una bomba en', 'se donde vives',
    'kill you', 'shoot you', 'stab you', 'murder you', 'rape you', 'kill yourself', 'i know where you live',
    'shoot up the', 'bomb the school', 'blow up the school',
  ],
});

// "negro"/"indio" en singular quedan fuera: tambien son colores o adjetivos ("el carro negro").
const HATE_GROUPS_ES = [
  'judios', 'negros', 'indios', 'indigenas', 'gays', 'homosexuales', 'maricones', 'lesbianas',
  'trans', 'travestis', 'venezolanos', 'venecos', 'colombianos', 'peruanos', 'haitianos',
  'cubanos', 'chinos', 'musulmanes', 'cristianos', 'catolicos', 'evangelicos', 'inmigrantes',
  'migrantes', 'gitanos', 'mujeres', 'cholos', 'montubios', 'afros', 'afroecuatorianos',
];
const HATE_GROUPS_EN = [
  'jews', 'blacks', 'gays', 'muslims', 'christians', 'immigrants', 'mexicans', 'asians',
  'women', 'trans', 'arabs', 'latinos',
];
const HATE_TEMPLATES_ES = [
  '{g} de mierda', 'muerte a los {g}', 'muerte a las {g}', 'malditos {g}', 'malditas {g}',
  '{g} asquerosos', '{g} asquerosas', '{g} sucios', 'exterminar a los {g}',
  'exterminar a las {g}', 'matar a todos los {g}', 'hay que matar a los {g}', 'fuera los {g}',
  'odio a los {g}', 'odio a las {g}', 'los {g} son una plaga', 'los {g} son basura',
  'los {g} son ratas', 'los {g} son inferiores', 'los {g} no son humanos',
];
const HATE_TEMPLATES_EN = [
  'death to {g}', 'death to the {g}', 'kill all {g}', 'kill all the {g}', 'gas the {g}',
  'i hate {g}', '{g} are animals', '{g} are subhuman', '{g} are vermin', 'filthy {g}',
  'exterminate the {g}', 'exterminate all {g}',
];

const HATE_TERMS = freezeGroup({
  words: [
    'sudaca', 'sudacas', 'veneco', 'venecos', 'nigger', 'niggers', 'faggot', 'faggots', 'kike',
    'kikes', 'spic', 'spics', 'chink', 'chinks', 'wetback', 'wetbacks', 'tranny', 'trannies',
    'longo', 'longos', '1488',
  ],
  phrases: [
    'heil hitler', 'sieg heil', 'white power', 'poder blanco', '14 88',
    ...expandTemplates(HATE_TEMPLATES_ES, HATE_GROUPS_ES),
    ...expandTemplates(HATE_TEMPLATES_EN, HATE_GROUPS_EN),
  ],
});

// Nivel estricto. Solo palabras exactas o prefijos seguros, nunca compactos: asi "computadora",
// "disputa", "reputacion", "carajillo", "cono" (de helado), "Puyo", "verguenza" o "padre putativo"
// pasan. "putamadre"/"de puta madre" se bloquea: aunque signifique "genial", es una groseria.
// "chuta", "caramba", "diablos" o "rayos" son eufemismos y se permiten.
const PROFANITY_TERMS = freezeGroup({
  words: [
    'mierd*', 'chucha', 'chuchas', 'chuchamadre', 'chuchatumadre', 'chuchesumadre', 'puta',
    'putas', 'puto', 'putos', 'putazo', 'putada', 'putamadre', 'putisima', 'putito', 'hijueputa',
    'hijueputas', 'hpta', 'hdp', 'ptm', 'ctm', 'csm', 'conchatumadre', 'conchesumadre', 'verga',
    'vergas', 'vergazo', 'vergon', 'vrg', 'alv', 'pendej*', 'cabron*', 'carajo', 'carajos',
    'joder', 'jodido', 'jodida', 'jodidos', 'jodete', 'coño', 'culo', 'culos', 'culero',
    'culera', 'chingad*', 'chingar*', 'chingon*', 'chinga', 'huevon', 'huevona', 'huevones',
    'huevada', 'huevadas', 'guevon', 'weon', 'cojudez', 'chimba', 'marica', 'maricas',
    'maricon', 'maricones', 'maricada', 'puñeta', 'cagar', 'cagada', 'cagadas', 'cagado',
    'cagon', 'tetas', 'fuck*', 'shit', 'shits', 'shitty', 'shithead', 'shitheads', 'shitting',
    'shitshow', 'bullshit', 'horseshit', 'damn', 'dammit', 'goddamn',
    'goddammit', 'bitch*', 'cunt', 'cunts', 'asshole*', 'arsehole', 'wtf', 'stfu', 'whore*',
    'slut', 'sluts',
  ],
  phrases: ['me cago en', 'la concha de tu madre', 'a la verga'],
});

// Insultos dirigidos. Las palabras ambiguas ("retrasado" en un vuelo, "burro", "perra", "rata")
// solo cuentan cuando se le dicen a alguien ("eres un ...", "you are a ...").
const INSULT_NOUNS_ES = [
  'tonto', 'tonta', 'bobo', 'boba', 'burro', 'burra', 'retrasado', 'retrasada', 'inutil',
  'basura', 'asco', 'perdedor', 'perdedora', 'zorra', 'perra', 'cerdo', 'cerda', 'rata',
  'payaso', 'payasa', 'gordo', 'gorda', 'feo', 'fea', 'animal', 'bestia', 'mongolo',
];
const INSULT_NOUNS_EN = ['loser', 'jerk', 'pig', 'clown', 'dumb', 'ugly', 'fat', 'trash'];
const INSULT_TEMPLATES_ES = ['eres un {g}', 'eres una {g}', 'eres {g}', 'sos un {g}', 'que {g} eres'];
const INSULT_TEMPLATES_EN = ['you are a {g}', 'you re a {g}', 'youre a {g}', 'ur a {g}', 'you are {g}'];

const INSULT_TERMS = freezeGroup({
  words: [
    'idiot*', 'estupid*', 'imbecil*', 'tarad*', 'subnormal', 'subnormales', 'mongolico',
    'mongolica', 'cojudo', 'cojuda', 'cojudos', 'baboso', 'babosa', 'pelotudo', 'pelotuda',
    'malparido', 'malparida', 'mamaverga', 'careverga', 'carechimba', 'gonorrea', 'stupid',
    'moron', 'morons', 'imbecile', 'retard', 'retards', 'retarded', 'dumbass', 'dickhead',
    'bastard', 'bastards',
  ],
  phrases: [
    'retrasado mental', 'retrasada mental', 'cara de verga', 'shut up idiot',
    ...expandTemplates(INSULT_TEMPLATES_ES, INSULT_NOUNS_ES),
    ...expandTemplates(INSULT_TEMPLATES_EN, INSULT_NOUNS_EN),
  ],
});

// El orden es la prioridad: lo primero que coincide decide la categoria. Las reglas con
// level STRICT solo se aplican en el nivel estricto y siempre despues de las graves.
// Cada regla exige que coincidan todos sus grupos (coocurrencia).
export const MODERATION_RULES = Object.freeze([
  { category: ModerationCategory.MINORS_SEXUAL, all: [MINORS_DIRECT_TERMS] },
  { category: ModerationCategory.MINORS_SEXUAL, all: [MINOR_REFERENCES, SEXUAL_REFERENCES] },
  { category: ModerationCategory.SEXUAL_EXPLICIT, all: [SEXUAL_EXPLICIT_TERMS] },
  { category: ModerationCategory.VIOLENT_THREAT, all: [VIOLENT_THREAT_TERMS] },
  { category: ModerationCategory.HATE, all: [HATE_TERMS] },
  { category: ModerationCategory.WEAPON_SALES, all: [SALE_REFERENCES, WEAPON_REFERENCES] },
  { category: ModerationCategory.DRUG_SALES, all: [SALE_REFERENCES, DRUG_REFERENCES] },
  { category: ModerationCategory.INSULT, level: ModerationLevel.STRICT, all: [INSULT_TERMS] },
  { category: ModerationCategory.PROFANITY, level: ModerationLevel.STRICT, all: [PROFANITY_TERMS] },
].map((rule) => Object.freeze({ ...rule, all: Object.freeze(rule.all) })));
