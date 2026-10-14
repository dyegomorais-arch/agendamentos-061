// Regras de horário da agenda OS 061 (usado por agenda.js e pdf.js)
// Duração de cada serviço, em horas
const DURACAO_SERVICO = { 'Instalação': 2, 'Desinstalação': 2, 'Manutenção': 2 };
// Expediente por local (12h às 13h é almoço, bloqueado).
// Salobo: o técnico fica na mina e precisa pegar o ônibus, então o último serviço termina às 15h.
const EXPEDIENTE_POR_LOCAL = {
  'Atendimento C.I': [[8, 12], [13, 17]],
  'Salobo': [[8, 12], [13, 15]]
};
const expedienteDe = local => EXPEDIENTE_POR_LOCAL[local] || EXPEDIENTE_POR_LOCAL['Atendimento C.I'];

const duracaoServico = s => DURACAO_SERVICO[s] ?? 2;
const horaDe = h => String(h).padStart(2, '0') + ':00';
const horaInt = hhmm => parseInt(String(hhmm).slice(0, 2), 10);
// texto do expediente para mensagens, ex.: "08–12h e 13–15h"
const textoExpediente = local => expedienteDe(local).map(([a, b]) => `${String(a).padStart(2, '0')}–${b}h`).join(' e ');
// o serviço que começa em `ini` e dura `dur` horas termina dentro do mesmo turno (daquele local)?
const cabeNoExpediente = (ini, dur, local) => expedienteDe(local).some(([a, b]) => ini >= a && ini + dur <= b);
// horários de início possíveis para o serviço naquele local (de hora em hora)
function horariosDoServico(servico, local) {
  const dur = duracaoServico(servico), lista = [], exp = expedienteDe(local);
  const ini = Math.min(...exp.map(t => t[0])), fim = Math.max(...exp.map(t => t[1]));
  for (let h = ini; h < fim; h++) if (cabeNoExpediente(h, dur, local)) lista.push(horaDe(h));
  return lista;
}
// ex.: "08:00 às 10:00"
const faixaHorario = a => horaDe(horaInt(a.horario)) + ' às ' + horaDe(horaInt(a.horario) + duracaoServico(a.servico));
