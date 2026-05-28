import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { Button, Card, TextInput } from '../../components/member';
import { useMemberAuth } from '../MemberAuth';

export function ProfileSetupPage(): JSX.Element {
  const { t } = useT();
  const nav = useNavigate();
  const { token, member, setMember } = useMemberAuth();
  const [name, setName] = useState(member?.displayName ?? '');
  const [country, setCountry] = useState(member?.country ?? 'IL');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!token) return <Navigate to="/auth" replace />;

  const submit = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await api.updateMe({
        displayName: name.trim() || null,
        country,
        phone: phone.trim() || null,
      });
      setMember(updated);
      nav('/home', { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold text-slate-900">{t('profile.title')}</h1>
      <div className="mt-8 space-y-5">
        <TextInput
          label={t('profile.displayName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
        <TextInput
          label={t('profile.country')}
          value={country}
          onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
        />
        <TextInput
          label={t('profile.phone')}
          type="tel"
          numeric
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />

        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex w-full items-center justify-between px-4 py-3 text-start text-sm font-medium text-slate-700"
          >
            {t('profile.kyc.disclosureTitle')}
            <span aria-hidden>{open ? '−' : '+'}</span>
          </button>
          {open && (
            <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
              {t('profile.kyc.disclosure')}
            </p>
          )}
        </Card>

        <Button full loading={saving} onClick={submit}>
          {saving ? t('profile.saving') : t('action.continue')}
        </Button>
      </div>
    </div>
  );
}
