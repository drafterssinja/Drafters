import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>Drafters</h1>
      <p className="subtitle">Backend real — registro, login e historial persistentes.</p>
      <Link href="/registro"><button>Crear cuenta</button></Link>
      <Link href="/login"><button className="secondary">Ya tengo cuenta</button></Link>
    </main>
  );
}
