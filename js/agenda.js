import {
  auth, db, onAuthStateChanged, signOut,
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, onSnapshot, serverTimestamp
} from './firebase.js';

const COLECAO = 'agendamentos'; 
const VAGAS = 1; // 1 técnico por local: no máximo 1 veículo por horário em C.I e 1 em Salobo (cada local conta separado)
const $ = id => document.getElementById(id);
// cache em memória, mantido em tempo real pelo Firestore (onSnapshot)
let cache = [];
const load = () => cache;
const DIAS = ['DOMINGO','SEGUNDA FEIRA','TERÇA FEIRA','QUARTA FEIRA','QUINTA FEIRA','SEXTA FEIRA','SÁBADO'];
const br = iso => iso.split('-').reverse().join('/');
const diaSemana = iso => DIAS[new Date(iso + 'T12:00').getDay()];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const isoDe = d => d.toISOString().slice(0, 10);
// ---------- quem criou / alterou ----------
const nomeCurto = e => (e ? String(e).split('@')[0] : '');
const quando = ts => {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
};
// "versão" do registro = momento da última gravação (0 enquanto o servidor ainda não confirmou)
const versaoDe = a => (a?.atualizadoEm || a?.criadoEm)?.toMillis?.() ?? 0;
let versaoBase = 0; // versão do agendamento no momento em que abri para editar
let visao = 'dia';
let editandoId = null;
const selectSyncs = {};

// ---------- select animado (Serviço, Local, Procurar por, Status, Alta) ----------
function customSelect(select) {
  const wrap = document.createElement('div');
  wrap.className = 'cselect';
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'cselect-btn';
  btn.innerHTML = '<span class="cselect-val"></span><span class="cselect-arrow">›</span>';
  const panel = document.createElement('div');
  panel.className = 'cselect-panel';
  [...select.options].forEach((o, i) => {
    const opt = document.createElement('div');
    opt.className = 'cselect-opt'; opt.dataset.value = o.value; opt.textContent = o.textContent;
    opt.style.setProperty('--i', i);
    panel.appendChild(opt);
  });
  wrap.append(btn, panel);
  select.insertAdjacentElement('afterend', wrap);
  select.classList.add('native-select');
  selectSyncs[select.name] = sync;

  function sync() {
    btn.querySelector('.cselect-val').textContent = select.options[select.selectedIndex]?.textContent || '';
    panel.querySelectorAll('.cselect-opt').forEach(o => o.classList.toggle('sel', o.dataset.value === select.value));
  }
  sync();

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const abrir = !wrap.classList.contains('open');
    document.querySelectorAll('.cselect.open').forEach(w => w.classList.remove('open'));
    if (abrir) wrap.classList.add('open');
  });
  panel.addEventListener('click', e => {
    const opt = e.target.closest('.cselect-opt'); if (!opt) return;
    select.value = opt.dataset.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync(); wrap.classList.remove('open');
  });
}
document.addEventListener('click', () => document.querySelectorAll('.cselect.open').forEach(w => w.classList.remove('open')));
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.cselect.open').forEach(w => w.classList.remove('open')); });

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 2800);
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- período (dia / semana / mês / todos) ----------
function periodo() {
  const ref = $('filtro').value;
  if (visao === 'todos' || !ref) return { ini: '0000-00-00', fim: '9999-99-99', rotulo: 'todos os períodos' };
  if (visao === 'dia') return { ini: ref, fim: ref, rotulo: 'dia ' + br(ref) };
  if (visao === 'mes') return { ini: ref.slice(0, 7) + '-01', fim: ref.slice(0, 7) + '-31', rotulo: 'mês ' + ref.slice(5, 7) + '/' + ref.slice(0, 4) };
  const d = new Date(ref + 'T12:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // segunda-feira
  const ini = isoDe(d);
  d.setDate(d.getDate() + 6);
  const fim = isoDe(d);
  return { ini, fim, rotulo: 'semana de ' + br(ini) + ' a ' + br(fim) };
}

// ---------- vagas por horário ----------
// Cada local tem o seu técnico (1 em C.I, 1 em Salobo). Cada serviço ocupa o técnico do seu local
// durante TODAS as horas da sua duração (Instalação, Desinstalação e Manutenção: 2h).
// Um horário só está livre se, em cada hora que o serviço ocuparia, o técnico daquele local estiver livre.
const horasDe = (horario, servico) =>
  Array.from({ length: duracaoServico(servico) }, (_, k) => horaInt(horario) + k);

const ocupadasNaHora = (data, hora, local, todos, excludeId) =>
  (todos || load()).filter(a => a.data === data && a.local === local && a.status !== 'Cancelado' && a.id !== excludeId
    && horasDe(a.horario, a.servico).includes(hora)).length;

const vagasLivres = (data, horario, servico, local, todos, excludeId) =>
  VAGAS - Math.max(...horasDe(horario, servico).map(h => ocupadasNaHora(data, h, local, todos, excludeId)));

// ---------- detecção de conflito pós-gravação ----------
// A checagem de vagas acima roda no navegador e não impede dois agendamentos simultâneos de
// passarem juntos. Estas funções detectam o excesso (mais serviços que técnicos) assim que ele
// aparece e avisam, para que alguém reagende um dos serviços.
function mapaOcupacao(todos) {
  const m = {};
  todos.forEach(a => {
    if (a.status === 'Cancelado') return;
    horasDe(a.horario, a.servico).forEach(h => { const k = a.data + '|' + a.local + '|' + h; m[k] = (m[k] || 0) + 1; });
  });
  return m;
}
// quantos serviços passam do limite do técnico daquele local nas horas deste agendamento (0 = sem conflito)
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
function esconderAlerta() {
  alertaDe = null;
  $('alerta').hidden = true;
}
// Roda a cada atualização em tempo real. Só olha o agendamento que acabei de salvar (por 30 s,
// para pegar o outro salvamento que chega com atraso) e o que já está no aviso; conflitos antigos
// não geram aviso novo, mas continuam marcados na lista.
function verificaConflito() {
  const ids = [alertaDe, vigia && Date.now() < vigia.ate ? vigia.id : null].filter(Boolean);
  if (!ids.length) return;
  const mapa = mapaOcupacao(load());
  for (const id of ids) {
    const a = cache.find(x => x.id === id);
    const exc = a ? excessoDe(a, mapa) : 0;
    if (exc > 0) return mostrarAlerta(a, exc);
  }
  if (alertaDe) esconderAlerta(); // o conflito foi resolvido (reagendado, cancelado ou excluído)
}
$('alertaFechar').addEventListener('click', () => { vigia = null; esconderAlerta(); });

function atualizaHorarios(todos, excludeId, preferido) {
  todos = todos || load();
  const f = $('form'), data = f.data.value, servico = f.servico.value, local = f.local.value;
  const dur = duracaoServico(servico);
  const atual = preferido || f.horario.value;
  f.horario.innerHTML = '';
  horariosDoServico(servico, local).forEach(h => {
    const o = document.createElement('option');
    o.value = h;
    const faixa = `${h} às ${horaDe(horaInt(h) + dur)}`;
    if (!data) o.textContent = faixa;
    else {
      const livres = vagasLivres(data, h, servico, local, todos, excludeId);
      o.textContent = livres > 0 ? `${faixa} (${livres} ${livres > 1 ? 'vagas' : 'vaga'})` : `${faixa} (lotado)`;
      o.disabled = livres <= 0;
    }
    f.horario.appendChild(o);
  });
  if (atual && [...f.horario.options].some(o => o.value === atual)) f.horario.value = atual;
  if (f.horario.selectedOptions[0]?.disabled) {
    const livre = [...f.horario.options].find(o => !o.disabled);
    if (livre) f.horario.value = livre.value;
  }
}
const refreshHorarios = preferido => atualizaHorarios(undefined, editandoId, preferido);

// ---------- lista ----------
function render() {
  const todos = load();
  const { ini, fim, rotulo } = periodo();
  const placaF = $('filtroPlaca').value.trim().toUpperCase();
  const dados = todos.filter(a => a.data >= ini && a.data <= fim && (!placaF || a.placa.toUpperCase().includes(placaF)))
    .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  $('resumo').textContent = `${dados.length} agendamento${dados.length === 1 ? '' : 's'} · ${rotulo}${placaF ? ' · placa "' + placaF + '"' : ''}`;
  atualizaHorarios(todos, editandoId);
  if (!dados.length) {
    $('lista').innerHTML = '<p class="empty">Nenhum agendamento neste período. Preencha o formulário para criar um.</p>';
    return;
  }
  const grupos = {};
  const ocup = mapaOcupacao(todos);
  dados.forEach(a => (grupos[a.data] = grupos[a.data] || []).push(a));
  $('lista').innerHTML = Object.entries(grupos).map(([d, itens]) => `
    <div class="day"><h3>AGENDA DE SERVIÇO - ${br(d)} · ${diaSemana(d)}</h3>
    <div class="tw"><table><thead><tr><th>Serviço</th><th>Placa</th><th>Tag</th><th>Veículo</th><th>Horário</th><th>Empresa</th><th>Local</th><th>Status</th><th>Alta</th><th>Agendado por</th><th></th></tr></thead>
    <tbody>${itens.map((a, i) => { const excede = excessoDe(a, ocup) > 0; return `<tr class="${excede ? 'conflito' : ''}" style="animation-delay:${i * 60}ms">
      <td>${esc(a.servico)}</td><td><b>${esc(a.placa)}</b></td><td>${esc(a.tag)}</td>
      <td>${esc(a.veiculo)}</td><td>${a.horario}${excede ? '<span class="warn" title="Este horário tem mais de um serviço no mesmo local. Reagende um deles.">⚠ acima do limite</span>' : ''}</td><td>${esc(a.empresa)}</td><td>${esc(a.local)}</td>
      <td><span class="badge b-${a.status}">${a.status}</span></td>
      <td>${a.alta ? `<span class="badge ${a.alta === 'SEM ALTA' ? 'b-semalta' : 'b-altaaberta'}">${esc(a.alta)}</span>` : '-'}</td>
      <td class="quem">${a.criadoPor ? `<span title="${esc(a.criadoPor)}">${esc(a.criadoPor)}</span>` : '-'}${a.atualizadoPor ? `<small title="${esc(a.atualizadoPor)}">alterado por ${esc(nomeCurto(a.atualizadoPor))}${quando(a.atualizadoEm) ? ' · ' + quando(a.atualizadoEm) : ''}</small>` : ''}</td>
      <td><button class="ico" title="Editar" data-edit="${a.id}">✏️</button><button class="ico" title="PDF de confirmação" data-pdf="${a.id}">📄</button><button class="ico" title="Excluir" data-del="${a.id}">🗑️</button></td>
    </tr>`; }).join('')}</tbody></table></div></div>`).join('');
}

// ---------- eventos ----------
function msgErro(err) {
  if (err?.code === 'permission-denied') return 'Sem permissão. Faça login novamente.';
  if (err?.code === 'unavailable') return 'Sem conexão com o servidor. Tente novamente.';
  return 'Erro ao salvar. Tente novamente.';
}

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const a = Object.fromEntries(new FormData(e.target));
  a.placa = a.placa.toUpperCase(); a.status = 'Agendado';
  const todos = load(); const idAtual = editandoId;
  const dur = duracaoServico(a.servico);
  if (!cabeNoExpediente(horaInt(a.horario), dur, a.local))
    return toast(`${a.servico} leva ${dur}h e não cabe nesse horário (expediente ${a.local}: ${textoExpediente(a.local)}). Escolha outro.`);
  if (vagasLivres(a.data, a.horario, a.servico, a.local, todos, idAtual) <= 0)
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
        btn.disabled = false; cancelarEdicao(); render();
        return toast('Este agendamento foi excluído por outra pessoa.');
      }
      const dados = { id: idAtual, ...atual.data() };
      if (versaoBase && versaoDe(dados) && versaoDe(dados) !== versaoBase) {
        const por = dados.atualizadoPor || dados.criadoPor || 'outro usuário';
        const manter = confirm(`${por} alterou este agendamento em ${quando(dados.atualizadoEm || dados.criadoEm)}, depois que você abriu a edição.\n\nOK = sobrescrever com o que você digitou\nCancelar = descartar o seu e carregar a versão mais recente`);
        if (!manter) { btn.disabled = false; iniciarEdicao(dados); return toast('Versão mais recente carregada. Confira e salve de novo se quiser.'); }
      }
    }
    if (idAtual) await updateDoc(doc(db, COLECAO, idAtual), { ...a, atualizadoEm: serverTimestamp(), atualizadoPor: quem });
    else idSalvo = (await addDoc(collection(db, COLECAO), { ...a, criadoEm: serverTimestamp(), criadoPor: quem })).id;
  } catch (err) {
    console.error(err); btn.disabled = false;
    return toast(msgErro(err));
  }
  btn.disabled = false;
  const eraEdicao = !!idAtual;
  cancelarEdicao();
  $('filtro').value = a.data; render(); toast(eraEdicao ? 'Agendamento atualizado!' : 'Agendamento salvo!');
  vigia = { id: idSalvo, ate: Date.now() + 30000 };
  verificaConflito();
});
$('form').data.addEventListener('change', () => refreshHorarios());
$('form').servico.addEventListener('change', () => refreshHorarios());
$('form').local.addEventListener('change', () => refreshHorarios());

// ---------- edição de agendamento existente ----------
function iniciarEdicao(a) {
  if (!a) return;
  editandoId = a.id;
  versaoBase = versaoDe(a);
  const f = $('form');
  ['servico', 'descricao', 'placa', 'tag', 'veiculo', 'empresa', 'data', 'horario', 'local', 'endereco', 'contato', 'alta']
    .forEach(n => { if (f[n]) f[n].value = a[n] ?? (n === 'alta' ? 'ALTA ABERTA' : ''); });
  refreshHorarios(a.horario);
  ['servico', 'local', 'contato', 'alta'].forEach(n => selectSyncs[n]?.());
  $('tituloForm').textContent = 'Editar agendamento';
  $('btnSalvar').textContent = 'Salvar alterações';
  $('btnCancelarEdicao').style.display = 'block';
  document.querySelector('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast('Editando agendamento — altere os campos e salve.');
}
function cancelarEdicao() {
  editandoId = null;
  $('form').reset();
  refreshHorarios();
  ['servico', 'local', 'contato', 'status', 'alta'].forEach(n => selectSyncs[n]?.());
  $('tituloForm').textContent = 'Novo agendamento';
  $('btnSalvar').textContent = 'Agendar';
  $('btnCancelarEdicao').style.display = 'none';
}
$('btnCancelarEdicao').addEventListener('click', cancelarEdicao);

// ---------- geração de PDF sem travar a interface ----------
function comLoading(botao, msgIni, gerar, msgFim) {
  if (botao) botao.disabled = true;
  toast(msgIni);
  setTimeout(() => {
    try { gerar(); toast(msgFim); }
    catch (err) { console.error(err); toast('Erro ao gerar o PDF. Veja o console.'); }
    finally { if (botao) botao.disabled = false; }
  }, 30); // dá um frame pro navegador pintar o toast antes do jsPDF travar a thread
}

$('lista').addEventListener('click', async e => {
  const btn = e.target.closest('button'); if (!btn) return;
  const del = btn.dataset.del, pdf = btn.dataset.pdf, edit = btn.dataset.edit;
  if (del && confirm('Excluir este agendamento?')) {
    try {
      await deleteDoc(doc(db, COLECAO, del));
      if (editandoId === del) cancelarEdicao();
      toast('Agendamento excluído.');
    } catch (err) { console.error(err); toast('Não foi possível excluir. Tente novamente.'); }
  }
  if (pdf) comLoading(btn, 'Gerando PDF de confirmação...', () => gerarPdfConfirmacao(load().find(a => a.id === pdf)), 'PDF de confirmação gerado!');
  if (edit) iniciarEdicao(load().find(a => a.id === edit));
});

$('tabs').addEventListener('click', e => {
  if (!e.target.dataset.v) return;
  visao = e.target.dataset.v;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b === e.target));
  render();
});
$('filtro').addEventListener('change', render);

$('pdfTec').addEventListener('click', () => {
  if (visao !== 'todos' && !$('filtro').value) return toast('Escolha a data de referência para gerar o PDF do técnico.');
  const { ini, fim, rotulo } = periodo();
  const placaF = $('filtroPlaca').value.trim().toUpperCase();
  const itens = load().filter(a => a.data >= ini && a.data <= fim && (!placaF || a.placa.toUpperCase().includes(placaF)))
    .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));
  if (!itens.length) return toast('Não há agendamentos nesse período.');
  comLoading($('pdfTec'), 'Gerando PDF do técnico...', () => gerarPdfTecnico({ ini, fim, rotulo }, itens), 'PDF do técnico gerado!');
});
$('filtroPlaca').addEventListener('input', debounce(render, 180));
// Local = Salobo preenche o endereço automaticamente com a Oficina Tauari; ao sair do Salobo,
// limpa o campo só se ainda for esse texto automático (não apaga um endereço digitado à mão).
const ENDERECO_SALOBO = 'OFICINA TAUARI (SALOBO)';
$('form').local.addEventListener('change', () => {
  const f = $('form');
  if (f.local.value === 'Salobo') f.endereco.value = ENDERECO_SALOBO;
  else if (f.endereco.value === ENDERECO_SALOBO) f.endereco.value = '';
});
$('btnEndereco').addEventListener('click', () => {
  $('form').endereco.value = 'Avenida Redenção, Quadra 01, Lotes 39, 40 e 41, Linha Verde, Parauapebas - PA, CEP 68.515-000';
});
['servico', 'local', 'contato', 'status', 'alta'].forEach(n => customSelect($('form')[n]));
$('sair').addEventListener('click', async () => { await signOut(auth); location.href = 'index.html'; });

const hoje = new Date(); hoje.setHours(12);
$('filtro').value = isoDe(hoje);

// ---------- autenticação + dados em tempo real ----------
let parar = null;
onAuthStateChanged(auth, user => {
  if (!user) { if (parar) parar(); location.href = 'index.html'; return; }
  document.body.style.visibility = 'visible';
  parar = onSnapshot(collection(db, COLECAO), snap => {
    cache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
    verificaConflito();
  }, err => {
    console.error(err);
    toast(err.code === 'permission-denied' ? 'Sem permissão para ler a agenda.' : 'Erro ao carregar a agenda.');
  });
});
