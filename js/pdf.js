const RED = [176, 30, 40], INK = [38, 40, 44], SOFT = [242, 243, 245];
const fmt = iso => iso.split('-').reverse().join('/');
const semana = iso => ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'][new Date(iso + 'T12:00').getDay()];
// horário do agendamento no PDF: só o início, pontual (ex.: 10h00)
const horarioPdf = a => String(horaInt(a.horario)).padStart(2, '0') + 'h00';

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
    let y = doc.lastAutoTable.finalY + 12;
    doc.setFillColor(...SOFT).roundedRect(14, y, 182, 42, 3, 3, 'F');
    doc.setFillColor(...RED).rect(14, y, 3, 42, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK).text('Onde comparecer', 22, y + 9);
    doc.setFont('helvetica', 'normal').setFontSize(10.5);
    doc.text('Local: ' + a.local, 22, y + 18);
    doc.text(doc.splitTextToSize('Endereço: ' + a.endereco, 168), 22, y + 25);
    doc.setFont('helvetica', 'bold').text('Procurar por: ' + a.contato, 22, y + 37);

    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(109, 112, 118)
      .text('Chegue com antecedência e apresente esta confirmação no atendimento.', 14, y + 54);

    // Orientações importantes
    const para1 = doc.splitTextToSize('Não atendemos nenhum veículo sem a presença de um acompanhante responsável no local. Se for notada a ausência do cliente ou acompanhante, o serviço será paralisado imediatamente até que o responsável retorne.', 174);
    const para2 = doc.splitTextToSize('Caso o retorno demore, passaremos para o próximo veículo agendado. O veículo que ficou sem acompanhante só será atendido novamente se houver tempo disponível no final do expediente.', 174);
    const bullets = [
      'Chegar no horário programado e comunicar eventuais atrasos.',
      'Veículo limpo internamente.',
      'Condutor aguardar o término do serviço, visto que o local possui rotatividade de veículos.',
      'Em caso de instalação: o veículo não pode ter outro sistema de telemetria/rastreador.'
    ].map(b => doc.splitTextToSize(b, 168));
    const obsLines = doc.splitTextToSize('Obs.: o local não permite a entrada com trajes inadequados (calção, bermuda, camiseta, chinelo, sandália).', 174);

    let estH = 8 + para1.length * 4.6 + 3 + para2.length * 4.6 + 4;
    bullets.forEach(bl => estH += bl.length * 4.6 + 1.2);
    estH += 3 + obsLines.length * 4.6;

    const pageH = doc.internal.pageSize.getHeight();
    let yO = y + 54 + 10;
    if (yO + estH > pageH - 16) { doc.addPage(); yO = 20; }

    doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...RED).text('Orientações importantes', 14, yO);
    yO += 7;
    doc.setFont('helvetica', 'normal').setFontSize(9.3).setTextColor(...INK);
    doc.text(para1, 14, yO);
    yO += para1.length * 4.6 + 3;
    doc.text(para2, 14, yO);
    yO += para2.length * 4.6 + 5;

    bullets.forEach(bl => {
      doc.setFillColor(...RED).circle(16, yO - 1.3, 0.9, 'F');
      doc.text(bl, 20, yO);
      yO += bl.length * 4.6 + 1.2;
    });

    yO += 3;
    doc.setFont('helvetica', 'italic').setFontSize(8.8).setTextColor(109, 112, 118);
    doc.text(obsLines, 14, yO);

  }

  rodape(doc);
  doc.save(a.placa + ' ' + fmt(a.data).replace(/\//g, '-') + '.pdf'); // barra não vale em nome de arquivo
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
  doc.save(nomeArq + '.pdf');
}
