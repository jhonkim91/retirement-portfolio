import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ACCOUNT_NAME,
  findAccountProfile,
  pickInitialAccountProfile,
  readStoredAccountName,
  resolveInitialAccountSelection,
  writeStoredAccountName
} from '../utils/api';

const normalizeProfiles = (profiles) => (
  Array.isArray(profiles)
    ? profiles.filter((profile) => profile && profile.account_name)
    : []
);

function useResolvedAccount() {
  const [accountName, setAccountName] = useState(() => readStoredAccountName() || DEFAULT_ACCOUNT_NAME);
  const [accountProfiles, setAccountProfiles] = useState([]);
  const [accountReady, setAccountReady] = useState(false);

  const changeAccountName = useCallback((value) => {
    const nextName = value || DEFAULT_ACCOUNT_NAME;
    writeStoredAccountName(nextName);
    setAccountName(nextName);
  }, []);

  const syncAccountProfiles = useCallback((profiles, preferredAccountName = '') => {
    const normalizedProfiles = normalizeProfiles(profiles);
    setAccountProfiles(normalizedProfiles);
    if (normalizedProfiles.length === 0) return;

    const preferredName = preferredAccountName || accountName;
    const matchedProfile = findAccountProfile(normalizedProfiles, preferredName);
    if (matchedProfile) {
      if (matchedProfile.account_name !== accountName) {
        writeStoredAccountName(matchedProfile.account_name);
        setAccountName(matchedProfile.account_name);
      }
      return;
    }

    const fallbackProfile = pickInitialAccountProfile(normalizedProfiles, preferredName);
    if (fallbackProfile?.account_name && fallbackProfile.account_name !== accountName) {
      writeStoredAccountName(fallbackProfile.account_name);
      setAccountName(fallbackProfile.account_name);
    }
  }, [accountName]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const resolved = await resolveInitialAccountSelection();
        if (!active) return;
        setAccountProfiles(normalizeProfiles(resolved.accountProfiles));
        setAccountName(resolved.accountName || DEFAULT_ACCOUNT_NAME);
      } catch (error) {
        if (!active) return;
        setAccountProfiles([]);
        setAccountName((previous) => previous || DEFAULT_ACCOUNT_NAME);
      } finally {
        if (active) setAccountReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const selectedAccountProfile = useMemo(() => (
    findAccountProfile(accountProfiles, accountName)
    || pickInitialAccountProfile(accountProfiles, accountName)
    || null
  ), [accountName, accountProfiles]);

  return {
    accountName,
    changeAccountName,
    accountProfiles,
    accountReady,
    selectedAccountProfile,
    syncAccountProfiles
  };
}

export default useResolvedAccount;
