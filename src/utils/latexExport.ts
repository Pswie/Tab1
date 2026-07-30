import { DailyLogEntry } from '../types';
import { formatCurrency, formatDateItalian } from './calculations';

/**
 * Genera il codice LaTeX completo, elegante ed ordinato per la stampa contabile della giornata.
 */
export function generateLatexReport(entry: DailyLogEntry): string {
  const formattedDate = formatDateItalian(entry.date);
  
  return `% =========================================================
% TEMPLATE CONTABILE TABACCHERIA - INCASSI GIORNALIERI
% Data: ${entry.date} (${formattedDate})
% =========================================================
\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{utf8}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{booktabs}
\\usepackage{xcolor}
\\usepackage{tabularx}
\\usepackage{helvet}
\\renewcommand{\\familydefault}{\\sfdefault}

% Definizioni Colori Brand Tabaccheria
\\definecolor{FerrariRed}{HTML}{E10600}
\\definecolor{PearlWhite}{HTML}{FAFAFC}
\\definecolor{DarkText}{HTML}{121316}
\\definecolor{EmeraldGreen}{HTML}{10B981}

\\pagestyle{empty}

\\begin{document}

% INTESTAZIONE REPORT
\\begin{center}
  {\\color{FerrariRed}\\LARGE \\textbf{TABACCHERIA}} \\[0.2cm]
  {\\Large \\textbf{Riepilogo Contabile Incassi Giornalieri}} \\[0.4cm]
  {\\small \\textbf{Data Riferimento:} ${formattedDate} (${entry.date})} \\\\
  \\vspace{0.3cm}
  {\\color{FerrariRed}\\hrule height 1.5pt}
\\end{center}

\\vspace{0.8cm}

% TABELLA DETTAGLIATA INCASSI
\\renewcommand{\\arraystretch}{1.4}
\\begin{tabularx}{\\linewidth}{X r}
  \\toprule
  \\textbf{Voce Operativa} & \\textbf{Importo (€)} \\\\
  \\midrule
  
  % SEZIONE VENDITE E SERVIZI
  Tabacchi & ${formatCurrency(entry.tabacchi)} \\\\
  Sisal & ${formatCurrency(entry.sisal)} \\\\
  Lis & ${formatCurrency(entry.lis)} \\\\
  Printer & ${formatCurrency(entry.printer)} \\\\
  \\midrule
  
  % SEZIONE MOVIMENTI LOTTO (DELIMITATA DA INDICATORE VERDE)
  \\multicolumn{2}{l}{\\textbf{\\color{EmeraldGreen}--- MOVIMENTI LOTTO ---}} \\\\
  Lotto Entrate & ${formatCurrency(entry.lotto_entrate)} \\\\
  Lotto Uscite & ${formatCurrency(entry.lotto_uscite)} \\\\
  Aggio Lotto (8\\%) & ${formatCurrency(entry.lotto_aggio || (entry.lotto_entrate * 0.08))} \\\\
  \\textbf{Lotto Netto (Subtotale)} & \\textbf{${formatCurrency(entry.lotto_netto)}} \\\\
  \\midrule
  
  % SEZIONE USCITE E FATTURE
  Fatture (Uscite) & ${formatCurrency(entry.fatture)} \\\\
  
  \\bottomrule
  \\specialrule{1.5pt}{2pt}{2pt}
  
  % TOTALE FINALE
  {\\color{FerrariRed}\\Large \\textbf{TOTALE GIORNATA}} & {\\color{FerrariRed}\\Large \\textbf{${formatCurrency(entry.totale_giornata)}}} \\\\
  \\bottomrule
\\end{tabularx}

\\vspace{1.5cm}

${entry.notes ? `
\\begin{center}
  \\begin{minipage}{0.9\\linewidth}
    \\textbf{Note Operative del Giorno:}\\\\
    \\textit{${entry.notes.replace(/%/g, '\\%').replace(/_/g, '\\_')}}
  \\end{minipage}
\\end{center}
\\vspace{1cm}
` : ''}

% PIÈ DI PAGINA
\\vfill
\\begin{center}
  {\\tiny Generato automaticamente dalla Web Application Tabaccheria --- ${new Date().toLocaleString('it-IT')}}
\\end{center}

\\end{document}
`;
}
