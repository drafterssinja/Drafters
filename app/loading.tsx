import Cargando from '@/components/Cargando';
import * as S from '@/lib/mockupStyles';

// 16/10 (Iñi): mientras se abre cualquier pantalla, la pelota que bota en vez
// de una pantalla vacía o un texto.
export default function Loading() {
  return (
    <main style={S.mainReset}>
      <div style={{ ...S.pageFrame, minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Cargando />
      </div>
    </main>
  );
}
