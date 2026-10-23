import './globals.css';
import { Suspense } from 'react';
import Nav from '../components/Nav';

export const metadata = {
  title: 'Guest Review Pulse · Azzurro Hotels',
  description: 'Booking.com guest reviews for Azzurro Hotels properties: ratings, trends and recurring issues.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-AU">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <a className="brand" href="/">
              <span className="brand-mark">Guest Review Pulse</span>
              <span className="brand-sub">Azzurro Hotels · Sydney</span>
            </a>
            <Suspense fallback={null}><Nav /></Suspense>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
