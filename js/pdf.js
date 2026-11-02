// Baixa o PDF direto para a pasta de downloads, sem abrir em nova aba/visualizador.
// (tipo "octet-stream" + atributo download impedem o navegador de abrir o arquivo sozinho)
function salvarPdf(doc, nome) {
  const blob = new Blob([doc.output('arraybuffer')], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

const RED = [176, 30, 40], INK = [38, 40, 44], SOFT = [242, 243, 245];
// Localização da Sillion C.I no Google Maps (link aparece no PDF só quando o local é Atendimento C.I)
const MAPS_CI = 'https://www.google.com/maps/place/SILLION+C.I+Paraupebas+I/@-6.0966629,-49.8717792,17z/data=!3m1!4b1!4m6!3m5!1s0x92dd51000621b71d:0x3d96dd61011ce8a0!8m2!3d-6.0966682!4d-49.8691989!16s%2Fg%2F11x162yjyl';
const ehCI = l => String(l || '').trim().toLowerCase() === 'atendimento c.i';
// horário do agendamento no PDF: só o início, pontual (ex.: 10h00)
const horarioPdf = a => String(horaInt(a.horario)).padStart(2, '0') + 'h00';
const fmt = iso => iso.split('-').reverse().join('/');
const semana = iso => ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][new Date(iso + 'T12:00').getDay()];

function cabecalho(doc, titulo, sub) {
  const w = doc.internal.pageSize.getWidth();
  doc.addImage(window.LOGO_CLARO, 'PNG', 14, 8, 28, 28);
  doc.setTextColor(...INK).setFont('helvetica', 'bold').setFontSize(18).text(titulo, w - 14, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(109, 112, 118).text(sub, w - 14, 27, { align: 'right' });
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...RED).text('OS 061', 48, 24, { charSpace: 0.6 });
  doc.setFillColor(...RED).rect(0, 38, w, 3, 'F');
}

function iconeSuporte(doc, cx, cy) {
  doc.setDrawColor(255, 255, 255).setFillColor(255, 255, 255).setLineWidth(0.35);
  doc.roundedRect(cx - 3.2, cy - 2.3, 6.4, 4.3, 1, 1, 'FD');
  doc.triangle(cx - 1.8, cy + 1.9, cx - 0.6, cy + 1.9, cx - 1.8, cy + 3.3, 'F');
  doc.setFillColor(...RED);
  doc.circle(cx - 1.4, cy - 0.15, 0.55, 'F');
  doc.circle(cx, cy - 0.15, 0.55, 'F');
  doc.circle(cx + 1.4, cy - 0.15, 0.55, 'F');
}

function rodape(doc) {
  const paginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    doc.setFillColor(...INK).rect(0, h - 12, w, 12, 'F');
    doc.setFontSize(8).setTextColor(255);
    doc.text('Sillion · Agenda de serviço · Emitido em ' + new Date().toLocaleString('pt-BR'), 14, h - 5);
    const label = 'Suporte: Dyego Morais';
    const textX = w - 14;
    const tw = doc.getTextWidth(label);
    doc.text(label, textX, h - 5, { align: 'right' });
    iconeSuporte(doc, textX - tw - 5, h - 6.3);
  }
}

function gerarPdfConfirmacao(a) {
  const doc = new jspdf.jsPDF();
  cabecalho(doc, 'Confirmação de agendamento', a.servico + ' · ' + a.placa);

  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK).text('Dados do agendamento', 14, 54);
  doc.autoTable({
    startY: 58, theme: 'grid', styles: { fontSize: 10, cellPadding: 3.5, lineColor: [226, 228, 232] },
    headStyles: { fillColor: RED, textColor: 255 }, alternateRowStyles: { fillColor: SOFT },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55, fillColor: SOFT } },
    head: [['Campo', 'Informação']],
    body: [
      ['Serviço', a.servico], ['Empresa', a.empresa],
      ['Placa', a.placa], ['Tag', a.tag || '-'], ['Tipo de veículo', a.veiculo],
      ['Data', fmt(a.data) + ' (' + semana(a.data) + ')'], ['Horário', horarioPdf(a)], ['Status', a.status], ['Alta', a.alta || '-'],
      ['Agendado por', a.criadoPor || '-'],
      ...(a.atualizadoPor ? [['Última alteração', a.atualizadoPor]] : []),
      // só no Salobo: mostra o endereço (Oficina Tauari) na tabela
      ...(String(a.local || '').trim().toLowerCase() === 'salobo' ? [['Endereço', a.endereco || '-']] : [])
    ]
  });

  // Salobo: PDF só com a tabela (sem "Onde comparecer" e sem orientações)
  if (String(a.local || '').trim().toLowerCase() !== 'salobo') {
    const ci = ehCI(a.local), ex = ci ? 10 : 0; // com link do mapa a caixa fica 10 mm mais alta
    let y = doc.lastAutoTable.finalY + 12;
    doc.setFillColor(...SOFT).roundedRect(14, y, 182, 42 + ex, 3, 3, 'F');
    doc.setFillColor(...RED).rect(14, y, 3, 42 + ex, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK).text('Onde comparecer', 22, y + 9);
    doc.setFont('helvetica', 'normal').setFontSize(10.5);
    doc.text('Local: ' + a.local, 22, y + 18);
    doc.text(doc.splitTextToSize('Endereço: ' + a.endereco, 168), 22, y + 25);
    doc.setFont('helvetica', 'bold').text('Procurar por: ' + a.contato, 22, y + 37);

    // Só no Atendimento C.I: pino de GPS + link "Clique aqui" para o Google Maps
    if (ci) {
      const px = 25, py = y + 43.6;
      doc.setFillColor(...RED);
      doc.triangle(px - 1.5, py + 0.9, px + 1.5, py + 0.9, px, py + 4.2, 'F');
      doc.circle(px, py, 2, 'F');
      doc.setFillColor(255, 255, 255).circle(px, py, 0.8, 'F');
      const txt = 'Clique aqui para abrir a localização no Google Maps';
      doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...RED);
      const tw = doc.getTextWidth(txt);
      doc.textWithLink(txt, 30, y + 46, { url: MAPS_CI });
      doc.setDrawColor(...RED).setLineWidth(0.3).line(30, y + 47.2, 30 + tw, y + 47.2);
      doc.link(22, y + 40, 8 + tw, 9, { url: MAPS_CI });
    }

    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(109, 112, 118)
      .text('Chegue com antecedência e apresente esta confirmação no atendimento.', 14, y + 54 + ex);

    // Orientações para atendimento no CI
    const LH = 4.6, W = 182, PAD = 14;
    const intro = doc.splitTextToSize('Para que o atendimento seja realizado de forma organizada e sem atrasos, pedimos que sejam observadas as seguintes orientações:', W);
    const ITENS = [
      ['Horário:', 'compareça no horário previamente programado. Caso ocorra algum imprevisto ou atraso, é importante comunicar antecipadamente. O tempo de tolerância para atraso é de 10 minutos.'],
      ['Condições do veículo:', 'o veículo deve estar limpo internamente, facilitando a realização do serviço e proporcionando melhores condições para o atendimento.'],
      ['Acompanhamento do serviço:', 'o condutor deverá permanecer no local e aguardar o término do atendimento, pois pode ser necessário realizar alguma verificação ou procedimento adicional no veículo.'],
      ['Instalação de equipamentos:', 'nos casos de instalação, o veículo não poderá possuir outro sistema de telemetria ou rastreador instalado. Essa condição é necessária para evitar interferências ou conflitos entre os sistemas.'],
      ['Vestimenta:', 'por se tratar de um local com normas específicas de acesso e segurança, não é permitida a entrada utilizando calção, bermuda, camiseta, chinelo ou sandália. É necessário comparecer utilizando vestimenta adequada para o ambiente.']
    ];
    const fecho = doc.splitTextToSize('O cumprimento dessas orientações ajuda a evitar atrasos, impedimentos de acesso e a necessidade de reagendamento do atendimento.', W);

    // quebra o texto de cada item deixando o rótulo (negrito) na 1ª linha
    doc.setFontSize(9.3);
    const itens = ITENS.map(([rot, txt]) => {
      doc.setFont('helvetica', 'bold');
      const rw = doc.getTextWidth(rot + ' ');
      doc.setFont('helvetica', 'normal');
      const linhas = []; let atual = '', disp = W - 6 - rw;
      txt.split(' ').forEach(w => {
        const t = atual ? atual + ' ' + w : w;
        if (doc.getTextWidth(t) > disp && atual) { linhas.push(atual); atual = w; disp = W - 6; } else atual = t;
      });
      if (atual) linhas.push(atual);
      return { rot, rw, linhas };
    });

    const pageH = doc.internal.pageSize.getHeight();
    let estH = 8 + intro.length * LH + 3 + fecho.length * LH + 4;
    itens.forEach(it => estH += it.linhas.length * LH + 1.8);
    let yO = y + 54 + ex + 10;
    if (yO + estH > pageH - 16) { doc.addPage(); yO = 20; }

    doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...RED).text('Orientações para atendimento no CI', PAD, yO);
    yO += 7;
    doc.setFont('helvetica', 'normal').setFontSize(9.3).setTextColor(...INK);
    doc.text(intro, PAD, yO);
    yO += intro.length * LH + 3;

    itens.forEach(it => {
      if (yO + it.linhas.length * LH > pageH - 16) { doc.addPage(); yO = 20; }
      doc.setFillColor(...RED).circle(PAD + 2, yO - 1.3, 0.9, 'F');
      doc.setFont('helvetica', 'bold').setTextColor(...INK).text(it.rot, PAD + 6, yO);
      doc.setFont('helvetica', 'normal');
      it.linhas.forEach((ln, i) => { doc.text(ln, PAD + 6 + (i === 0 ? it.rw : 0), yO); yO += LH; });
      yO += 1.8;
    });

    yO += 2;
    if (yO + fecho.length * LH > pageH - 16) { doc.addPage(); yO = 20; }
    doc.setFont('helvetica', 'italic').setFontSize(8.8).setTextColor(109, 112, 118);
    doc.text(fecho, PAD, yO);
  }

  rodape(doc);
  salvarPdf(doc, a.placa + ' ' + fmt(a.data).replace(/\//g, '-') + '.pdf'); // barra não vale em nome de arquivo
}

function gerarPdfTecnico(periodo, itens) {
  const { ini, fim, rotulo } = periodo;
  const umDia = ini === fim;
  const doc = new jspdf.jsPDF({ orientation: 'landscape' });
  const sub = umDia ? fmt(ini) + ' · ' + semana(ini) : rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
  cabecalho(doc, 'Agenda de serviço', sub);
  doc.autoTable({
    startY: 48, theme: 'grid', styles: { fontSize: 10, cellPadding: 3.2, lineColor: [226, 228, 232] },
    headStyles: { fillColor: INK, textColor: 255 }, alternateRowStyles: { fillColor: SOFT },
    head: [['Data', 'Horário', 'Serviço', 'Placa', 'Tag', 'Veículo', 'Empresa', 'Local', 'Agendado por']],
    body: itens.map(a => [fmt(a.data), horarioPdf(a), a.servico + (a.descricao ? ' - ' + a.descricao : ''), a.placa, a.tag || '-', a.veiculo, a.empresa, a.local, a.criadoPor || '-']),
    columnStyles: { 0: { fontStyle: 'bold' }, 1: { fontStyle: 'bold', textColor: RED } },
    margin: { bottom: 16 }
  });
  rodape(doc);
  const d = iso => fmt(iso).replace(/\//g, '-'); // barra não vale em nome de arquivo
  const nomeArq = ini === '0000-00-00' ? 'AGENDA' : umDia ? 'AGENDA ' + d(ini) : 'AGENDA ' + d(ini) + ' a ' + d(fim);
  salvarPdf(doc, nomeArq + '.pdf');
}
