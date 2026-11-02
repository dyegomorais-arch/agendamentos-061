import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, onSnapshot, serverTimestamp
} from './firebase.js';

const COLECAO = 'agendamentos';
const VAGAS = 1; // 1 técnico por local: no máximo 1 veículo por horário em C.I e 1 em Salobo (cada local conta separado)
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const br = i => i.split('-').reverse().join('/');
// data local (YYYY-MM-DD) — evita virar "amanhã" à noite por causa do fuso (toISOString usa UTC)
const isoDe = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const DIAS = ['DOMINGO', 'SEGUNDA FEIRA', 'TERÇA FEIRA', 'QUARTA FEIRA', 'QUINTA FEIRA', 'SEXTA FEIRA', 'SÁBADO'];
const diaSem = i => DIAS[new Date(i + 'T12:00').getDay()];

// cache em memória, mantido em tempo real pelo Firestore (onSnapshot)
let cache = [];
const load = () => cache;

// ---------- quem criou / alterou ----------
const nomeCurto = e => (e ? String(e).split('@')[0] : '');
const quando = ts => {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
};
// "versão" do registro = momento da última gravação (0 enquanto o servidor ainda não confirmou)
const versaoDe = a => (a?.atualizadoEm || a?.criadoEm)?.toMillis?.() ?? 0;
let versaoBase = 0; // versão do agendamento no momento em que abri para editar

let editId = null, visao = 'dia', tt;
const abertos = new Set(); // cartões expandidos (não fecham quando a lista atualiza em tempo real)
const st = { servico: 'Instalação', local: 'Atendimento C.I', contato: 'GERSON SANTOS', alta: 'ALTA ABERTA' };

function toast(m) {
  const t = $('toast'); t.textContent = m; t.classList.add('on');
  clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 2800);
}

// ripple nos botões
document.addEventListener('click', e => {
  const b = e.target.closest('.btn'); if (!b) return;
  const r = b.getBoundingClientRect(), s = document.createElement('span'), d = Math.max(r.width, r.height);
  s.className = 'ripple';
  s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(s); setTimeout(() => s.remove(), 600);
});

// ---------- chips (Serviço, Local, Procurar por, Alta) ----------
const OPC = {
  chServ: ['servico', ['Instalação', 'Desinstalação', 'Manutenção']],
  chLocal: ['local', ['Atendimento C.I', 'Salobo']],
  chContato: ['contato', ['GERSON SANTOS', 'EVANDRO BRAGA']],
  chAlta: ['alta', ['ALTA ABERTA', 'SEM ALTA']]
};
function chips() {
  for (const [id, [k, ops]] of Object.entries(OPC))
    $(id).innerHTML = ops.map(o => `<button type="button" class="chip ${st[k] === o ? 'on' : ''}" data-k="${k}" data-v="${o}">${o}</button>`).join('');
}
const ENDERECO_SALOBO = 'OFICINA TAUARI (SALOBO)';
document.addEventListener('click', e => {
  const c = e.target.closest('.chip'); if (!c) return;
  st[c.dataset.k] = c.dataset.v; chips();
  if (c.dataset.k === 'servico' || c.dataset.k === 'local') horarios(); // expediente depende do serviço e do local
  if (c.dataset.k === 'local') {
    // Salobo preenche o endereço sozinho; ao sair do Salobo limpa só se ainda for o texto automático
    const f = $('form');
    if (st.local === 'Salobo') f.endereco.value = ENDERECO_SALOBO;
    else if (f.endereco.value === ENDERECO_SALOBO) f.endereco.value = '';
  }
});

// ---------- vagas por horário ----------
// Cada local tem o seu técnico (1 em C.I, 1 em Salobo). Cada serviço ocupa o técnico do seu local
// durante TODAS as horas da sua duração (Instalação, Desinstalação e Manutenção: 2h).
const horasDe = (horario, servico) =>
  Array.from({ length: duracaoServico(servico) }, (_, k) => horaInt(horario) + k);

const ocupadasNaHora = (data, hora, local, excludeId) =>
  load().filter(a => a.data === data && a.local === local && a.status !== 'Cancelado' && a.id !== excludeId
    && horasDe(a.horario, a.servico).includes(hora)).length;

const vagasLivres = (data, horario, servico, local, excludeId) =>
  VAGAS - Math.max(...horasDe(horario, servico).map(h => ocupadasNaHora(data, h, local, excludeId)));

// ---------- detecção de conflito pós-gravação ----------
// A checagem de vagas roda no navegador e não impede dois agendamentos simultâneos de passarem
// juntos. Estas funções detectam o excesso (mais serviços que técnicos no local) assim que ele aparece.
function mapaOcupacao(todos) {
  const m = {};
  todos.forEach(a => {
    if (a.status === 'Cancelado') return;
    horasDe(a.horario, a.servico).forEach(h => { const k = a.data + '|' + a.local + '|' + h; m[k] = (m[k] || 0) + 1; });
  });
  return m;
}
const excessoDe = (a, mapa) =>
  a.status === 'Cancelado' ? 0 : Math.max(0, ...horasDe(a.horario, a.servico).map(h => (mapa[a.data + '|' + a.local + '|' + h] || 0) - VAGAS));

let vigia = null;    // agendamento que ESTE usuário acabou de salvar: { id, ate }
let alertaDe = null; // id do agendamento cujo conflito está no aviso fixo da tela

function mostrarAlerta(a, excesso) {
  alertaDe = a.id;
  $('alertaTxt').textContent =
    `Conflito de horário: ${faixaHorario(a)} em ${br(a.data)} ficou com ${VAGAS + excesso} serviços em ${a.local}, mas só há ${VAGAS} técnico lá. ` +
    `Reagende ou cancele um dos serviços desse horário (a placa que você acabou de salvar é ${a.placa}).`;
  $('alerta').hidden = false;
}
function esconderAlerta() { alertaDe = null; $('alerta').hidden = true; }
// Só olha o agendamento que acabei de salvar (por 30 s) e o que já está no aviso;
// conflitos antigos não geram aviso novo, mas continuam marcados na lista.
function verificaConflito() {
  const ids = [alertaDe, vigia && Date.now() < vigia.ate ? vigia.id : null].filter(Boolean);
  if (!ids.length) return;
  const mapa = mapaOcupacao(load());
  for (const id of ids) {
    const a = cache.find(x => x.id === id);
    const exc = a ? excessoDe(a, mapa) : 0;
    if (exc > 0) return mostrarAlerta(a, exc);
  }
  if (alertaDe) esconderAlerta();
}
$('alertaFechar').addEventListener('click', () => { vigia = null; esconderAlerta(); });

// ---------- horários do formulário ----------
function horarios(pref) {
  $('mSub').textContent = `${st.servico} · duração de ${duracaoServico(st.servico)}h · ${st.local} · ${VAGAS} técnico por horário`;
  const f = $('form'), d = f.data.value, at = pref || f.horario.value;
  f.horario.innerHTML = '';
  horariosDoServico(st.servico, st.local).forEach(h => {
    const o = document.createElement('option');
    o.value = h;
    const fx = `${h} às ${horaDe(horaInt(h) + duracaoServico(st.servico))}`;
    if (!d) o.textContent = fx;
    else {
      const l = vagasLivres(d, h, st.servico, st.local, editId);
      o.textContent = l > 0 ? `${fx} (${l} ${l > 1 ? 'vagas' : 'vaga'})` : `${fx} (lotado)`;
      o.disabled = l <= 0;
    }
    f.horario.appendChild(o);
  });
  if (at && [...f.horario.options].some(o => o.value === at && !o.disabled)) f.horario.value = at;
  else { const l = [...f.horario.options].find(o => !o.disabled); if (l) f.horario.value = l.value; }
}
$('form').data.addEventListener('change', () => horarios());

// ---------- navegação (menu hambúrguer) ----------
const TIT = { painel: 'Painel', agenda: 'Agenda' };
function menu(on) {
  $('drawer').classList.toggle('on', on);
  $('veil').classList.toggle('on', on);
  $('burger').classList.toggle('open', on);
}
$('burger').onclick = () => menu(!$('drawer').classList.contains('on'));
$('veil').onclick = () => menu(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape') menu(false); });

function go(v) {
  document.querySelectorAll('.view').forEach(s => { s.classList.add('hide'); s.style.animation = 'none'; });
  const s = $('v-' + v); s.classList.remove('hide'); void s.offsetWidth; s.style.animation = '';
  document.querySelectorAll('.nav[data-go]').forEach(n => n.classList.toggle('on', n.dataset.go === v));
  $('titulo').firstChild.textContent = TIT[v];
  menu(false); scrollTo({ top: 0, behavior: 'smooth' });
  render(true);
}

// ---------- modal de novo agendamento / edição ----------
function abrir() {
  menu(false); horarios();
  document.querySelectorAll('#modal .field,#modal .sec').forEach((el, i) => el.style.setProperty('--n', i));
  $('modal').classList.add('on'); document.body.style.overflow = 'hidden';
  setTimeout(() => $('form').placa.focus(), 450);
}
function fechar() {
  $('modal').classList.remove('on'); document.body.style.overflow = '';
  setTimeout(cancelar, 300);
}
$('fab').onclick = abrir; $('mx').onclick = fechar; $('btnCancel').onclick = fechar;
$('modal').onclick = e => { if (e.target === $('modal')) fechar(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('modal').classList.contains('on')) fechar(); });
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (!g) return;
  g.dataset.go === 'novo' ? abrir() : go(g.dataset.go);
});

// ---------- painel ----------
function contar(el, n, anima) {
  if (!anima || n === 0) { el.textContent = n; return; }
  let i = 0; const p = Math.max(1, Math.ceil(n / 20));
  const t = setInterval(() => { i = Math.min(n, i + p); el.textContent = i; if (i >= n) clearInterval(t); }, 30);
}
function painel(anima) {
  const t = load(), hj = isoDe(new Date()), h = new Date().getHours();
  const ini = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDe(d); })();
  const fimSem = isoDe(new Date(new Date(ini + 'T12:00').getTime() + 6 * 864e5));
  const nome = nomeCurto(auth.currentUser?.email);
  $('hello').textContent = (h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite') + (nome ? ', ' + nome : '') + ' 👋';
  const ativos = t.filter(a => a.status !== 'Cancelado');
  const S = [
    ['Hoje', ativos.filter(a => a.data === hj).length, 'dia'],
    ['Esta semana', ativos.filter(a => a.data >= ini && a.data <= fimSem).length, 'semana'],
    ['Este mês', ativos.filter(a => a.data.slice(0, 7) === hj.slice(0, 7)).length, 'mes'],
    ['Total', ativos.length, 'todos']
  ];
  $('stats').innerHTML = S.map((s, i) => `<div class="stat" style="--i:${i}${anima ? '' : ';animation:none'}" data-vis="${s[2]}"><b>0</b><span>${s[0]}</span></div>`).join('');
  document.querySelectorAll('.stat b').forEach((b, i) => contar(b, S[i][1], anima));
  const prox = ativos.filter(a => a.data >= hj && a.status !== 'Concluído')
    .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario)).slice(0, 4);
  $('proximos').innerHTML = prox.length
    ? prox.map((a, i) => card(a, i, false, anima)).join('')
    : '<p class="empty">Nenhum serviço agendado. Que tal criar o primeiro?</p>';
  $('bdTotal').textContent = ativos.length;
}
document.addEventListener('click', e => {
  const s = e.target.closest('.stat'); if (!s) return;
  visao = s.dataset.vis;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === visao));
  $('filtro').value = isoDe(new Date()); go('agenda');
});

// ---------- agenda ----------
function periodo() {
  const r = $('filtro').value;
  if (visao === 'todos' || !r) return { ini: '0000-00-00', fim: '9999-99-99', rotulo: 'todos os períodos' };
  if (visao === 'dia') return { ini: r, fim: r, rotulo: 'dia ' + br(r) };
  if (visao === 'mes') return { ini: r.slice(0, 7) + '-01', fim: r.slice(0, 7) + '-31', rotulo: 'mês ' + r.slice(5, 7) + '/' + r.slice(0, 4) };
  const d = new Date(r + 'T12:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // segunda-feira
  const ini = isoDe(d);
  d.setDate(d.getDate() + 6);
  const fim = isoDe(d);
  return { ini, fim, rotulo: 'semana de ' + br(ini) + ' a ' + br(fim) };
}

const classeStatus = s => s === 'Concluído' ? 'ok' : s === 'Confirmado' ? 'cf' : s === 'Cancelado' ? 'ca' : '';

function card(a, i, acoes = true, anima = true) {
  const ex = excessoDe(a, mapaOcupacao(load())) > 0;
  const animStyle = anima ? `animation-delay:${i * 60}ms` : 'animation:none';
  return `<div class="ag ${ex ? 'conf' : ''} ${a.status === 'Concluído' ? 'done' : ''} ${abertos.has(a.id) ? 'open' : ''}" style="${animStyle}" data-open="${a.id}">
 <div class="hr">${a.horario}<small>${horaDe(horaInt(a.horario) + duracaoServico(a.servico))}</small></div>
 <div class="m"><b>${esc(a.placa)}</b> · ${esc(a.servico)}${ex ? ' <span class="warn" title="Este horário tem mais de um serviço no mesmo local. Reagende um deles.">⚠ acima do limite</span>' : ''}<div>${esc(a.empresa)} · ${esc(a.veiculo)} · ${esc(a.local)} · ${br(a.data)}</div></div>
 ${acoes ? `<div><button class="ico" title="Concluir / reabrir" data-ok="${a.id}">✅</button><button class="ico" title="Editar" data-edit="${a.id}">✏️</button><button class="ico" title="PDF de confirmação" data-pdf="${a.id}">📄</button><button class="ico" title="Excluir" data-del="${a.id}">🗑️</button></div>` : '<div></div>'}
 <div class="det"><p><span class="badge ${classeStatus(a.status)}">${esc(a.status)}</span><span class="badge ${a.alta === 'SEM ALTA' ? 'sa' : 'al'}">${esc(a.alta || '-')}</span></p>
 <p>Tag: ${esc(a.tag || '-')} · Procurar por: ${esc(a.contato)}</p><p>Endereço: ${esc(a.endereco)}</p>${a.descricao ? `<p>Obs.: ${esc(a.descricao)}</p>` : ''}
 <p class="quem">Agendado por ${esc(a.criadoPor || '-')}${a.atualizadoPor ? `<small>alterado por ${esc(nomeCurto(a.atualizadoPor))}${quando(a.atualizadoEm) ? ' · ' + quando(a.atualizadoEm) : ''}</small>` : ''}</p></div></div>`;
}

function render(anima = false) {
  painel(anima);
  const { ini, fim, rotulo } = periodo(), pf = $('filtroPlaca').value.trim().toUpperCase();
  const dd = load().filter(a => a.data >= ini && a.data <= fim && (!pf || a.placa.toUpperCase().includes(pf)))
    .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  $('resumo').textContent = `${dd.length} agendamento${dd.length === 1 ? '' : 's'} · ${rotulo}${pf ? ' · placa "' + pf + '"' : ''}`;
  if ($('modal').classList.contains('on')) horarios(); // vagas atualizam em tempo real com o modal aberto
  if (!dd.length) { $('lista').innerHTML = '<p class="empty">Nenhum agendamento neste período.</p>'; return; }
  const g = {}; dd.forEach(a => (g[a.data] = g[a.data] || []).push(a));
  $('lista').innerHTML = Object.entries(g).map(([d, it]) =>
    `<div class="day"><h3>AGENDA DE SERVIÇO - ${br(d)} · ${diaSem(d)}</h3>${it.map((a, i) => card(a, i, true, anima)).join('')}</div>`).join('');
}
$('tabs').onclick = e => {
  if (!e.target.dataset.v) return;
  visao = e.target.dataset.v;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b === e.target));
  render(true);
};
$('filtro').onchange = () => render(true);
let tdeb; $('filtroPlaca').oninput = () => { clearTimeout(tdeb); tdeb = setTimeout(() => render(false), 180); };

// ---------- salvar (cria / atualiza no Firestore) ----------
function msgErro(err) {
  if (err?.code === 'permission-denied') return 'Sem permissão. Faça login novamente.';
  if (err?.code === 'unavailable') return 'Sem conexão com o servidor. Tente novamente.';
  return 'Erro ao salvar. Tente novamente.';
}

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = $('form');
  const a = {
    servico: st.servico, descricao: f.descricao.value, placa: f.placa.value.toUpperCase(), tag: f.tag.value,
    veiculo: f.veiculo.value.trim(), empresa: f.empresa.value, data: f.data.value, horario: f.horario.value,
    local: st.local, endereco: f.endereco.value, contato: st.contato, alta: st.alta
  };
  if (!a.veiculo) return toast('Selecione o tipo de veículo.');
  const idAtual = editId, todos = load();
  const dur = duracaoServico(a.servico);
  if (!cabeNoExpediente(horaInt(a.horario), dur, a.local))
    return toast(`${a.servico} leva ${dur}h e não cabe nesse horário (expediente ${a.local}: ${textoExpediente(a.local)}). Escolha outro.`);
  if (vagasLivres(a.data, a.horario, a.servico, a.local, idAtual) <= 0)
    return toast(`Horário lotado: ${a.horario} às ${horaDe(horaInt(a.horario) + dur)} em ${br(a.data)} já tem o técnico de ${a.local} ocupado. Escolha outro horário.`);
  if (todos.some(x => x.data === a.data && x.horario === a.horario && x.placa === a.placa && x.id !== idAtual))
    return toast(`A placa ${a.placa} já está agendada em ${br(a.data)} às ${a.horario}.`);

  const btn = $('btnSalvar'); btn.disabled = true;
  let idSalvo = idAtual;
  try {
    const quem = auth.currentUser?.email || '';
    if (idAtual) {
      // aviso de conflito: alguém salvou este agendamento depois que eu abri para editar?
      const atual = await getDoc(doc(db, COLECAO, idAtual));
      if (!atual.exists()) {
        btn.disabled = false; fechar(); render();
        return toast('Este agendamento foi excluído por outra pessoa.');
      }
      const dados = { id: idAtual, ...atual.data() };
      if (versaoBase && versaoDe(dados) && versaoDe(dados) !== versaoBase) {
        const por = dados.atualizadoPor || dados.criadoPor || 'outro usuário';
        const manter = confirm(`${por} alterou este agendamento em ${quando(dados.atualizadoEm || dados.criadoEm)}, depois que você abriu a edição.\n\nOK = sobrescrever com o que você digitou\nCancelar = descartar o seu e carregar a versão mais recente`);
        if (!manter) { btn.disabled = false; iniciarEdicao(dados); return toast('Versão mais recente carregada. Confira e salve de novo se quiser.'); }
      }
      // o status NÃO é alterado na edição (Concluído/Confirmado/etc. são preservados)
      await updateDoc(doc(db, COLECAO, idAtual), { ...a, atualizadoEm: serverTimestamp(), atualizadoPor: quem });
    } else {
      idSalvo = (await addDoc(collection(db, COLECAO), { ...a, status: 'Agendado', criadoEm: serverTimestamp(), criadoPor: quem })).id;
    }
  } catch (err) {
    console.error(err); btn.disabled = false;
    return toast(msgErro(err));
  }
  btn.disabled = false;
  const eraEdicao = !!idAtual;
  fechar();
  $('filtro').value = a.data; visao = 'dia';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === 'dia'));
  toast(eraEdicao ? 'Agendamento atualizado! ✅' : 'Agendamento salvo! ✅');
  go('agenda');
  vigia = { id: idSalvo, ate: Date.now() + 30000 };
  verificaConflito();
});

function cancelar() {
  editId = null; versaoBase = 0;
  $('form').reset();
  st.servico = 'Instalação'; st.local = 'Atendimento C.I'; st.contato = 'GERSON SANTOS'; st.alta = 'ALTA ABERTA';
  chips(); horarios();
  $('tituloForm').textContent = 'Novo agendamento'; $('btnSalvar').textContent = 'Agendar';
}
$('btnEnd').onclick = () => $('form').endereco.value = 'Avenida Redenção, Quadra 01, Lotes 39, 40 e 41, Linha Verde, Parauapebas - PA, CEP 68.515-000';

// ---------- edição de agendamento existente ----------
function iniciarEdicao(a) {
  if (!a) return;
  editId = a.id; versaoBase = versaoDe(a);
  const f = $('form');
  ['descricao', 'placa', 'tag', 'veiculo', 'empresa', 'data', 'endereco'].forEach(n => f[n].value = a[n] || '');
  Object.assign(st, { servico: a.servico, local: a.local, contato: a.contato, alta: a.alta || 'ALTA ABERTA' });
  chips(); horarios(a.horario);
  $('tituloForm').textContent = 'Editar agendamento'; $('btnSalvar').textContent = 'Salvar alterações';
  abrir();
}

// ---------- ações nos cartões ----------
function comLoading(botao, msgIni, gerar, msgFim) {
  if (botao) botao.disabled = true;
  toast(msgIni);
  setTimeout(() => {
    try { gerar(); toast(msgFim); }
    catch (err) { console.error(err); toast('Erro ao gerar o PDF. Veja o console.'); }
    finally { if (botao) botao.disabled = false; }
  }, 30); // dá um frame pro navegador pintar o toast antes do jsPDF travar a thread
}

async function acao(e) {
  const b = e.target.closest('button');
  if (!b) {
    const c = e.target.closest('[data-open]');
    if (c) { const id = c.dataset.open; c.classList.toggle('open'); c.classList.contains('open') ? abertos.add(id) : abertos.delete(id); }
    return;
  }
  const { del, pdf, edit, ok } = b.dataset;
  if (ok) {
    const a = load().find(x => x.id === ok); if (!a) return;
    const novo = a.status === 'Concluído' ? 'Agendado' : 'Concluído';
    try {
      await updateDoc(doc(db, COLECAO, ok), { status: novo, atualizadoEm: serverTimestamp(), atualizadoPor: auth.currentUser?.email || '' });
      toast(novo === 'Concluído' ? 'Serviço concluído! ✅' : 'Agendamento reaberto.');
    } catch (err) { console.error(err); toast(msgErro(err)); }
  }
  if (del && confirm('Excluir este agendamento?')) {
    try {
      await deleteDoc(doc(db, COLECAO, del));
      abertos.delete(del);
      toast('Agendamento excluído.');
    } catch (err) { console.error(err); toast('Não foi possível excluir. Tente novamente.'); }
  }
  if (pdf) comLoading(b, 'Gerando PDF de confirmação...', () => gerarPdfConfirmacao(load().find(a => a.id === pdf)), 'PDF de confirmação gerado! 📄');
  if (edit) iniciarEdicao(load().find(a => a.id === edit));
}
$('lista').addEventListener('click', acao);
$('proximos').addEventListener('click', acao);

$('pdfTec').onclick = () => {
  if (visao !== 'todos' && !$('filtro').value) return toast('Escolha a data de referência para gerar o PDF do técnico.');
  const p = periodo(), pf = $('filtroPlaca').value.trim().toUpperCase();
  const it = load().filter(a => a.data >= p.ini && a.data <= p.fim && (!pf || a.placa.toUpperCase().includes(pf)))
    .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  if (!it.length) return toast('Não há agendamentos nesse período.');
  comLoading($('pdfTec'), 'Gerando PDF do técnico...', () => gerarPdfTecnico(p, it), 'PDF do técnico gerado! 📄');
};

// ---------- sair ----------
const PORTAL = 'https://dyegomorais-arch.github.io/portaldeos/';
let saindo = false;
$('sair').onclick = async () => { saindo = true; await signOut(auth); location.href = PORTAL; };

// ---------- inicialização ----------
$('filtro').value = isoDe(new Date());
chips(); horarios();

// ---------- autenticação + dados em tempo real ----------
let parar = null, primeira = true;
onAuthStateChanged(auth, user => {
  if (!user) { if (parar) parar(); location.href = saindo ? PORTAL : 'index.html'; return; }
  document.body.style.visibility = 'visible';
  $('usr').textContent = user.email || '';
  go('painel');
  if (parar) parar();
  parar = onSnapshot(collection(db, COLECAO), snap => {
    cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render(primeira); primeira = false;
    verificaConflito();
  }, err => {
    console.error(err);
    toast(err.code === 'permission-denied' ? 'Sem permissão para ler a agenda.' : 'Erro ao carregar a agenda.');
  });
});
