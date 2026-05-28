import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { Button, Card, TextInput, useToast } from '../../components/member';
import { LangToggle } from '../MemberShell';
import { useMemberAuth } from '../MemberAuth';
import type { KycStatus } from '../../lib/contract';

const KYC_KEY: Record<KycStatus, 'profile.kyc.NONE' | 'profile.kyc.PENDING' | 'profile.kyc.VERIFIED' | 'profile.kyc.REJECTED'> = {
  NONE: 'profile.kyc.NONE',
  PENDING: 'profile.kyc.PENDING',
  VERIFIED: 'profile.kyc.VERIFIED',
  REJECTED: 'profile.kyc.REJECTED',
};

export function ProfilePage(): JSX.Element {
  const { t } = useT();
  const nav = useNavigate();
  const toast = useToast();
  const { member, setMember, signOut } = useMemberAuth();
  const [name, setName] = useState(member?.displayName ?? '');
  const [saving, setSaving] = useState(false);

  if (!member)
    return (
      <div className="mx-auto max-w-md px-4 py-8 text-slate-400">
        {t('common.loading')}
      </div>
    );

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await api.updateMe({ displayName: name.trim() || null });
      setMember(updated);
      toast.show(t('action.save'), 'success');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-xl font-semibold text-slate-900">{t('nav.profile')}</h1>

      <Card className="mt-6 space-y-4 p-5">
        <TextInput
          label={t('profile.displayName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="text-sm text-slate-500">
          <p>{member.email ?? member.phone}</p>
          <p className="mt-0.5">{member.country}</p>
        </div>
        <Button loading={saving} onClick={save}>
          {saving ? t('profile.saving') : t('action.save')}
        </Button>
      </Card>

      <Card className="mt-4 p-5">
        <p className="text-sm font-medium text-slate-700">
          {t('profile.kycStatus')}
        </p>
        <p className="mt-1 text-sm text-slate-900">{t(KYC_KEY[member.kycStatus])}</p>
        <p className="mt-2 text-xs text-slate-500">
          {t('profile.kyc.disclosure')}
        </p>
        {member.kycStatus === 'PENDING' && (
          <Button variant="secondary" className="mt-3">
            {t('profile.verifyNow')}
          </Button>
        )}
      </Card>

      <Card className="mt-4 flex items-center justify-between p-5">
        <span className="text-sm font-medium text-slate-700">
          {t('profile.language')}
        </span>
        <LangToggle />
      </Card>

      <div className="mt-6">
        <Button
          variant="ghost"
          onClick={() => {
            signOut();
            nav('/', { replace: true });
          }}
        >
          {t('action.signOut')}
        </Button>
      </div>
    </div>
  );
}
