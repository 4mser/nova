/* Pestañas en anillo: se cambia de pantalla arrastrando hacia el lado (o con la barra flotante) y se da la vuelta:
   Hoy ⇄ Crew ⇄ Bitácora ⇄ Salud (Cuerpo | Mente) ⇄ Tú ⇄ Hoy. La barra muestra las cuatro primeras; Tú se abre
   deslizando o desde el avatar. */
import { BarraTabs } from '../../ui/BarraTabs';
import { Paginador, type PropsBarra } from '../../ui/Paginador';
import { C } from '../../ui/tema';

const EN_BARRA = ['index', 'crew', 'journal', 'salud'];

export default function LayoutTabs() {
  return (
    <Paginador initialRouteName="index" fondo={C.bg} enBarra={EN_BARRA} tabBar={(p: PropsBarra) => <BarraTabs {...p} />}>
      <Paginador.Screen name="index" options={{ title: 'Today' }} />
      <Paginador.Screen name="crew" options={{ title: 'Crew' }} />
      <Paginador.Screen name="journal" options={{ title: 'Log' }} />
      <Paginador.Screen name="salud" options={{ title: 'Health' }} />
      <Paginador.Screen name="perfil" options={{ title: 'You' }} />
    </Paginador>
  );
}
