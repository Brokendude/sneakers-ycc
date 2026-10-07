import { Archivo_Black, Public_Sans } from 'next/font/google';
import './globals.css';

const display = Archivo_Black({ subsets: ['latin'], weight: '400', variable: '--font-display' });
const body = Public_Sans({ subsets: ['latin'], variable: '--font-body' });

export const metadata = {
  title: 'sneakers.ycc — Solana wallet PnL',
  description: 'Paste any Solana wallet and see what it really made, in SOL, USD or Naira.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
