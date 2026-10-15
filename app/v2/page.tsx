'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Drafters V2 (15/10, Iñi): al entrar, de serie, fútbol — directamente a sus salas.
export default function V2Entrada() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/v2/futbol');
  }, [router]);
  return null;
}
