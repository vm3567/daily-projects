// Auto-correct for common typing mistakes — no AI, no internet: a fixed list of wrong → right words.
// It fixes a word when you finish it (a space or . , ; : ! ? after it). Backspace right after a fix puts your
// own spelling back (like the iPhone). The browser's own spell check (red underline) also stays on.

const FIXES = {
  // swapped / missing letters in everyday words
  teh: 'the', hte: 'the', thw: 'the', tje: 'the', th: null, adn: 'and', nad: 'and', anf: 'and', amd: 'and',
  taht: 'that', thta: 'that', tath: 'that', waht: 'what', whta: 'what', wht: 'what', wiht: 'with', whit: null, wtih: 'with',
  fo: null, fro: 'for', ofr: 'for', form: null, yuo: 'you', yoru: 'your', yuor: 'your', oyu: 'you', ot: 'to', tot: null,
  si: 'is', taht_: null, jsut: 'just', juts: 'just', jst: 'just', knwo: 'know', konw: 'know', nkow: 'know',
  dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", wont: "won't", isnt: "isn't", wasnt: "wasn't",
  arent: "aren't", werent: "weren't", havent: "haven't", hasnt: "hasn't", couldnt: "couldn't", shouldnt: "shouldn't",
  wouldnt: "wouldn't", im: "I'm", ive: "I've", youre: "you're", theyre: "they're", thats: "that's", whats: "what's",
  lets: null, its: null, ill: null, id: null, hes: null, shes: null,
  i: 'I',
  // the user's own frequent slips
  shoudl: 'should', shuold: 'should', shold: 'should', sould: 'should', woudl: 'would', wolud: 'would', coudl: 'could', cuold: 'could',
  becasue: 'because', becuase: 'because', beacuse: 'because', becaus: 'because', bcause: 'because', becouse: 'because',
  snedin: 'sending', sendig: 'sending', sedning: 'sending', sned: 'send', sedn: 'send',
  conection: 'connection', connetion: 'connection', conenct: 'connect', conect: 'connect', connnect: 'connect', conencted: 'connected',
  betwene: 'between', betwen: 'between', bewteen: 'between', betweeen: 'between',
  stesp: 'steps', setps: 'steps', sepcs: 'specs', aupdate: 'update', udpate: 'update', upadte: 'update', updtae: 'update', updaet: 'update',
  speel: 'spell', spel: 'spell', misatek: 'mistake', mistkae: 'mistake', mistak: 'mistake', mistaek: 'mistake',
  comman: 'common', commen: 'common', comon: 'common', acheive: 'achieve', achive: 'achieve', acheived: 'achieved',
  dahsboard: 'dashboard', dashbaord: 'dashboard', projcet: 'project', porject: 'project', proejct: 'project', prject: 'project',
  projets: 'projects', projetcs: 'projects', progect: 'project', tsak: 'task', taks: 'task', tasl: 'task',
  recieve: 'receive', recieved: 'received', reciept: 'receipt', beleive: 'believe', belive: 'believe', freind: 'friend',
  wierd: 'weird', thier: 'their', theri: 'their', untill: 'until', occured: 'occurred', occurence: 'occurrence',
  seperate: 'separate', seperately: 'separately', definately: 'definitely', definatly: 'definitely', defintely: 'definitely',
  accomodate: 'accommodate', adress: 'address', adresses: 'addresses', agian: 'again', agin: 'again', alot: 'a lot',
  allready: 'already', alredy: 'already', alraedy: 'already', allways: 'always', alwasy: 'always', alwyas: 'always',
  aboutt: 'about', abotu: 'about', abuot: 'about', befor: 'before', beofre: 'before', bfore: 'before',
  buisness: 'business', busines: 'business', bussiness: 'business', calender: 'calendar', calandar: 'calendar',
  certian: 'certain', chnage: 'change', chagne: 'change', chnages: 'changes', cheif: 'chief', colum: 'column',
  comming: 'coming', commited: 'committed', commitee: 'committee', compleet: 'complete', compelte: 'complete', complte: 'complete',
  completly: 'completely', concious: 'conscious', contian: 'contain', contians: 'contains', copmany: 'company', comapny: 'company',
  compnay: 'company', custmer: 'customer', cusotmer: 'customer', cutomer: 'customer', costumer: 'customer',
  deliverd: 'delivered', delivary: 'delivery', diffrent: 'different', differnt: 'different', dicuss: 'discuss', disucss: 'discuss',
  discus: 'discuss', doign: 'doing', donig: 'doing', dosent: "doesn't", ealier: 'earlier', eariler: 'earlier', efect: 'effect',
  enviroment: 'environment', enviornment: 'environment', excercise: 'exercise', exmaple: 'example', examle: 'example',
  existance: 'existence', experiance: 'experience', expereince: 'experience', finaly: 'finally', finsih: 'finish', finshed: 'finished',
  finsihed: 'finished', folow: 'follow', follwo: 'follow', folowup: 'follow-up', followup: 'follow-up', foward: 'forward',
  frist: 'first', fisrt: 'first', fianl: 'final', gaurd: 'guard', goign: 'going', giong: 'going', govenment: 'government',
  grammer: 'grammar', gonna: null, happend: 'happened', hapen: 'happen', hapened: 'happened', heigth: 'height', hieght: 'height',
  immediatly: 'immediately', imediately: 'immediately', importnat: 'important', improtant: 'important', imporant: 'important',
  independant: 'independent', infomation: 'information', informaton: 'information', interupt: 'interrupt', intrest: 'interest',
  isue: 'issue', isssue: 'issue', knowlege: 'knowledge', langauge: 'language', lenght: 'length', liason: 'liaison',
  libary: 'library', lisence: 'licence', maintainance: 'maintenance', maintenence: 'maintenance', managment: 'management',
  manger: 'manager', meeitng: 'meeting', meetign: 'meeting', metting: 'meeting', mesage: 'message', messgae: 'message', mesages: 'messages',
  minuts: 'minutes', mintues: 'minutes', mroe: 'more', moer: 'more', neccessary: 'necessary', necesary: 'necessary', neccesary: 'necessary',
  nedd: 'need', neeed: 'need', noticable: 'noticeable', occassion: 'occasion', oppurtunity: 'opportunity', opportunty: 'opportunity',
  orignal: 'original', ohter: 'other', otehr: 'other', ther: 'there', tehre: 'there', thier_: null, peice: 'piece', peopel: 'people',
  poeple: 'people', pepole: 'people', persue: 'pursue', posible: 'possible', possable: 'possible', prefered: 'preferred',
  presense: 'presence', priviledge: 'privilege', probaly: 'probably', probabaly: 'probably', problme: 'problem', porblem: 'problem',
  proble: 'problem', proccess: 'process', procces: 'process', prodcut: 'product', prodution: 'production', publically: 'publicly',
  qoute: 'quote', quaity: 'quality', qualtiy: 'quality', quantiy: 'quantity', realy: 'really', relaly: 'really', reallly: 'really',
  recomend: 'recommend', reccomend: 'recommend', recommed: 'recommend', refered: 'referred', remeber: 'remember', rember: 'remember',
  repot: 'report', reprot: 'report', resposne: 'response', responce: 'response', resturant: 'restaurant', rythm: 'rhythm',
  sample_: null, smaple: 'sample', samlpe: 'sample', sampels: 'samples', scedule: 'schedule', schedual: 'schedule', shedule: 'schedule',
  sicne: 'since', simlar: 'similar', similiar: 'similar', somthing: 'something', someting: 'something', soemthing: 'something',
  succesful: 'successful', successfull: 'successful', sucess: 'success', suppplier: 'supplier', suplier: 'supplier', supllier: 'supplier',
  suprise: 'surprise', tehy: 'they', thye: 'they', tihs: 'this', thsi: 'this', htis: 'this', tommorow: 'tomorrow', tomorow: 'tomorrow',
  tommorrow: 'tomorrow', tomorrw: 'tomorrow', todya: 'today', toady: 'today', tody: 'today', tounge: 'tongue', truely: 'truly',
  twelth: 'twelfth', tyhe: 'they', usualy: 'usually', vaccum: 'vacuum', wehre: 'where', whcih: 'which', wich: 'which', whihc: 'which',
  wiull: 'will', wil: 'will', wokr: 'work', wrok: 'work', owrk: 'work', wrokign: 'working', workign: 'working', wroking: 'working',
  writting: 'writing', wriet: 'write', yeild: 'yield', yesterady: 'yesterday', yestreday: 'yesterday', yetserday: 'yesterday',
  // work words for this user (ceramics)
  ceramci: 'ceramic', cermaic: 'ceramic', ceramc: 'ceramic', glzae: 'glaze', galze: 'glaze', kilm: 'kiln', klin: 'kiln',
  firng: 'firing', fireing: 'firing', moudl: 'mould', mold_: null, sampel: 'sample', tesitng: 'testing', testign: 'testing',
  defetc: 'defect', defcet: 'defect', defets: 'defects', qoutation: 'quotation', quatation: 'quotation', invocie: 'invoice',
  invioce: 'invoice', paymnet: 'payment', pyament: 'payment', prise: null, ordr: 'order', oder: 'order', dleivery: 'delivery',
};

// Words to never touch (null entries above) are dropped; keys are lower-case.
const MAP = new Map(Object.entries(FIXES).filter(([k, v]) => v && !k.endsWith('_')));
const ENDERS = /[\s.,;:!?)\]]/;
let enabled = true;
let fixing = false; // our own "input" signal after a fix must not be fixed again
let last = null; // { el, start, from, to } — the last fix, so Backspace can undo it

/** Keep the capital letters the person typed: "Teh" → "The", "TEH" → "THE". */
function matchCase(typed, fix) {
  if (typed === typed.toUpperCase() && typed.length > 1) return fix.toUpperCase();
  if (typed[0] === typed[0].toUpperCase()) return fix[0].toUpperCase() + fix.slice(1);
  return fix;
}

/** The fix for one word, or null. (Exported for the automatic tests.) */
export function fixWord(word) {
  if (!word || word.length < 1 || /\d/.test(word)) return null;
  const fix = MAP.get(word.toLowerCase());
  if (!fix) return null;
  if (fix === 'I') return word === 'i' ? 'I' : null; // only a lone small "i"
  const out = matchCase(word, fix);
  return out === word ? null : out;
}

function isTextBox(el) {
  if (!el) return false;
  if (el.nodeName === 'TEXTAREA') return true;
  return el.nodeName === 'INPUT' && (el.type === 'text' || el.type === 'search' || el.type === '' || !el.getAttribute('type'));
}

function onInput(e) {
  const el = e.target;
  if (!enabled || fixing || !isTextBox(el) || el.dataset.noAutocorrect !== undefined) return;
  if (e.inputType && !e.inputType.startsWith('insert')) return; // only while typing forwards
  const pos = el.selectionStart;
  if (pos == null || pos !== el.selectionEnd || pos < 2) return;
  const v = el.value;
  if (!ENDERS.test(v[pos - 1])) return;
  // the word just finished, right before the space / punctuation
  let start = pos - 1;
  while (start > 0 && /[\p{L}\p{N}'’_@#/.:-]/u.test(v[start - 1])) start--;
  let word = v.slice(start, pos - 1);
  if (!word || /[@#/:]/.test(word) || word.includes('.')) return; // @names, #tags, links, file names: left alone
  word = word.replace(/^['’]+|['’]+$/g, '');
  const fix = fixWord(word);
  if (!fix) return;
  const wStart = v.indexOf(word, start);
  el.value = v.slice(0, wStart) + fix + v.slice(wStart + word.length);
  const caret = pos + (fix.length - word.length);
  el.setSelectionRange(caret, caret);
  last = { el, start: wStart, from: word, to: fix, caret };
  fixing = true;
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } finally { fixing = false; } // the app's own handlers see the fixed text
}

function onKeydown(e) {
  if (!last || e.target !== last.el) { last = null; return; }
  const el = last.el;
  if (e.key === 'Backspace' && el.selectionStart === last.caret && el.selectionEnd === last.caret) {
    // Backspace right after a fix: put back what was typed (keeps the space)
    e.preventDefault();
    const v = el.value;
    el.value = v.slice(0, last.start) + last.from + v.slice(last.start + last.to.length);
    const caret = last.caret - (last.to.length - last.from.length);
    el.setSelectionRange(caret, caret);
    fixing = true;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } finally { fixing = false; }
  }
  last = null;
}

export function setAutocorrect(on) { enabled = !!on; }
export function autocorrectOn() { return enabled; }

/** Turn on auto-correct for every text box. (The browser's own spell check — red underline — and the iPhone's auto-correct stay on as well.) */
export function installAutocorrect(isOn = true) {
  enabled = isOn;
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKeydown, true);
}
