'use client';

import Link from 'next/link';
import LoMasCaliente from '@/components/LoMasCaliente';

const ACCENT = '#3DDC84';

function FeatureCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div style={{ background: '#131917', border: '1px solid #1E2723', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {icon}
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: '#F5F7F5' }}>{title}</span>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: '#8B958F' }}>{text}</span>
    </div>
  );
}

function SportInfoCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div style={{ background: '#131917', border: '1px solid #1E2723', borderRadius: 14, padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
      {icon}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 17, color: '#F5F7F5' }}>{title}</span>
        <span style={{ fontSize: 13, lineHeight: 1.5, color: '#8B958F' }}>{text}</span>
      </div>
    </div>
  );
}

function Step({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', background: ACCENT, color: '#04140B', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {n}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 18, color: '#F5F7F5' }}>{title}</span>
        <span style={{ fontSize: 14, lineHeight: 1.5, color: '#8B958F' }}>{text}</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <main style={{ maxWidth: 'none', margin: 0, padding: 0, display: 'block' }}>
      <div style={{ width: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', background: '#0B0F0E', maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid #1A211D' }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: '0.06em', color: '#F5F7F5' }}>DRAFTERS</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link href="/login" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13, color: '#F5F7F5', background: 'transparent', border: '1px solid #2A3733', padding: '8px 14px', borderRadius: 8, display: 'inline-flex', alignItems: 'center' }}>
              Iniciar sesión
            </Link>
            <Link href="/registro" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 13, color: '#0B0F0E', background: ACCENT, padding: '9px 16px', borderRadius: 8, display: 'inline-flex', alignItems: 'center' }}>
              Únete
            </Link>
          </div>
        </div>

        {/* Hero */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '36px 20px 32px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', background: 'rgba(255,122,69,0.12)', border: '1px solid rgba(255,122,69,0.35)', borderRadius: 999, padding: '6px 12px 6px 10px' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF7A45' }} />
            <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#FF9F6E' }}>
              Puntuación en vivo
            </span>
          </div>

          <h1 style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.08, color: '#F5F7F5', fontFamily: "'Barlow Condensed', sans-serif", margin: 0 }}>
            El fantasy que puntúa cada jugada, no solo el resultado.
          </h1>

          <p style={{ fontSize: 16, lineHeight: 1.55, color: '#AAB4AE', fontWeight: 400, margin: 0 }}>
            Fútbol, golf y tenis con puntuación en vivo, jugada a jugada. Elige tu equipo, elige tu formato, compite de verdad.
          </p>

          <Link
            href="/registro"
            style={{ alignSelf: 'flex-start', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#04140B', background: ACCENT, padding: '14px 26px', borderRadius: 10, display: 'inline-flex', alignItems: 'center' }}
          >
            Únete ahora
          </Link>

          {/* Lo más caliente ahora — datos reales, rotando fútbol → golf cada 3 s (09/10) */}
          <LoMasCaliente />
        </div>

        {/* Qué es Drafters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '44px 20px' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: '#F5F7F5', margin: 0 }}>Más que un resultado final.</h2>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: '#AAB4AE', margin: 0 }}>
            En las porras tradicionales solo importa quién gana. En Drafters cada birdie, cada ace y cada entrada ganada suma.
            Nuestro sistema de puntuación premia el detalle de cada jugador, para que sientas la competición como si estuvieras dentro.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginTop: 6 }}>
            <FeatureCard
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" strokeWidth="1.6">
                  <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              }
              title="Puntuación en vivo"
              text="Cada acción suma en tiempo real, no solo el resultado final."
            />
            <FeatureCard
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" strokeWidth="1.6">
                  <line x1="4" y1="7" x2="20" y2="7" strokeLinecap="round" />
                  <circle cx="14" cy="7" r="2.2" />
                  <line x1="4" y1="17" x2="20" y2="17" strokeLinecap="round" />
                  <circle cx="9" cy="17" r="2.2" />
                </svg>
              }
              title="Tu formato, tus reglas"
              text="Elige el número de rivales y el formato de tu liga."
            />
            <FeatureCard
              icon={
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" strokeWidth="1.6">
                  <path d="M8 21h8" strokeLinecap="round" />
                  <path d="M12 17v4" strokeLinecap="round" />
                  <path d="M6 4h12v3a6 6 0 0 1-12 0V4Z" strokeLinejoin="round" />
                  <path d="M6 5H3v1a4 4 0 0 0 4 4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M18 5h3v1a4 4 0 0 1-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
              title="Fútbol, golf y tenis"
              text="Compite en los deportes que sigues de verdad."
            />
          </div>
        </div>

        {/* Elige tu deporte */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 20px 44px' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: '#F5F7F5', margin: 0 }}>Elige tu deporte.</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <SportInfoCard
              icon={
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F5F7F5" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7.5 15.5 10l-1.3 4h-4.4L8.5 10Z" strokeLinejoin="round" />
                  <path d="M12 3v4.5M12 20.5V16.5M20.6 8.7 16.2 10M3.4 8.7 7.8 10M20.6 15.3 16.2 14M3.4 15.3 7.8 14" />
                </svg>
              }
              title="Fútbol"
              text="Goles, asistencias y también las jugadas defensivas que otros ignoran."
            />
            <SportInfoCard
              icon={
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F5F7F5" strokeWidth="1.5">
                  <path d="M7 21h6" strokeLinecap="round" />
                  <path d="M9 21V4" strokeLinecap="round" />
                  <path d="M9 4l9 3.5L9 11" strokeLinejoin="round" />
                </svg>
              }
              title="Golf"
              text="Cada golpe, cada racha, cada vuelta sin bogeys."
            />
            <SportInfoCard
              icon={
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F5F7F5" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M4.5 7.5C7 9 8.5 12 8.5 15.5" strokeLinecap="round" />
                  <path d="M19.5 16.5C17 15 15.5 12 15.5 8.5" strokeLinecap="round" />
                </svg>
              }
              title="Tenis"
              text="Cada game, cada break, cada set cuenta."
            />
          </div>
        </div>

        {/* Así funciona */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '8px 20px 44px' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, color: '#F5F7F5', margin: 0 }}>Así funciona.</h2>
          <Step n={1} title="Elige tu equipo" text="Arma tu equipo dentro de tu presupuesto." />
          <Step n={2} title="Sigue la puntuación en vivo" text="Mira cómo suben y bajan los puntos jugada a jugada." />
          <Step n={3} title="Compite en tu formato" text="Tú decides cuántos rivales y qué está en juego." />
        </div>

        {/* Únete / Inicia sesión */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '44px 20px 56px', borderTop: '1px solid #1A211D', background: '#0E1310' }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: '#F5F7F5', margin: 0 }}>Entra en el juego.</h2>
          <p style={{ fontSize: 14, lineHeight: 1.55, color: '#AAB4AE', margin: 0 }}>Crea tu equipo y compite ya en fútbol, golf y tenis.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <Link
              href="/registro"
              style={{ width: '100%', textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#04140B', background: ACCENT, borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Únete
            </Link>
            <Link
              href="/login"
              style={{ width: '100%', textAlign: 'center', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 16, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#F5F7F5', background: 'transparent', border: '1px solid #2A3733', borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Iniciar sesión
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '20px 20px 28px', borderTop: '1px solid #1A211D' }}>
          <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: '0.05em', color: '#F5F7F5' }}>DRAFTERS</span>
          <span style={{ fontSize: 12, color: '#6B756F' }}>Fútbol · Golf · Tenis — puntuación en vivo.</span>
          <span style={{ fontSize: 11, color: '#4E574F' }}>© 2026 Drafters</span>
        </div>
      </div>
    </main>
  );
}
