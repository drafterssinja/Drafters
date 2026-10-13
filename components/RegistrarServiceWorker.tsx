'use client';

import { useEffect } from 'react';
import { registrarAperturaSiToca, registrarUsoApp } from '@/lib/usoApp';
import { supabase } from '@/lib/supabaseClient';

// Registra public/sw.js (necesario para que Android ofrezca instalar la app)
// y guarda el aviso de instalación de Android (beforeinstallprompt), que el
// navegador lanza una sola vez al cargar — así el botón "Añadir a Android"
// lo tiene disponible aunque se pinte más tarde (ver InstalarApp.tsx).
export default function RegistrarServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __draftersInstalar?: Event | null };
    const alAviso = (e: Event) => {
      e.preventDefault();
      w.__draftersInstalar = e;
      window.dispatchEvent(new Event('drafters-instalable'));
    };
    const alInstalar = () => {
      w.__draftersInstalar = null;
      void registrarUsoApp('instalada');
      window.dispatchEvent(new Event('drafters-instalada'));
    };
    // 13/10: estadística de aperturas desde el icono (y al iniciar sesión).
    void registrarAperturaSiToca();
    const { data: sub } = supabase.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_IN') void registrarAperturaSiToca();
    });
    window.addEventListener('beforeinstallprompt', alAviso);
    window.addEventListener('appinstalled', alInstalar);
    if (!('serviceWorker' in navigator)) return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('beforeinstallprompt', alAviso);
      window.removeEventListener('appinstalled', alInstalar);
    };
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Si falla, la web funciona igual; solo no se podrá instalar en Android.
    });
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('beforeinstallprompt', alAviso);
      window.removeEventListener('appinstalled', alInstalar);
    };
  }, []);
  return null;
}
