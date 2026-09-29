import { redirect } from 'next/navigation';

/** The old English settings page. Everything it held now lives under Aap. */
export default function SettingsPage() {
  redirect('/you');
}
