/* /mind ya no es una pestaña: Mente vive dentro de Salud */
import { Redirect } from 'expo-router';
export default function IrAMente() { return <Redirect href={{ pathname: '/salud', params: { seg: 'mente' } }} />; }
