import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export function useUserProfile(email) {
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!email) {
      setIsLoading(false);
      return;
    }

    const fetchProfile = async () => {
      try {
        const [userDoc, submissionDoc] = await Promise.all([
          getDoc(doc(db, 'users', email)),
          getDoc(doc(db, 'kyc_submissions', email)),
        ]);

        if (userDoc.exists()) {
          const data = userDoc.data() || {};
          const normalizeKycStatus = (value) => String(value || '').trim().toLowerCase();
          const userKycStatus = normalizeKycStatus(data.kycStatus);
          const submissionKycStatus = submissionDoc.exists() ? normalizeKycStatus(submissionDoc.data()?.kycStatus) : '';
          const effectiveKycStatus = userKycStatus || submissionKycStatus;

          if (effectiveKycStatus && userKycStatus !== effectiveKycStatus) {
            await setDoc(doc(db, 'users', email), {
              kycStatus: effectiveKycStatus,
              updatedAt: new Date().toISOString(),
            }, { merge: true });
          }

          setProfile({
            ...data,
            kycStatus: effectiveKycStatus || data.kycStatus || null,
          });
        }
        setIsLoading(false);
      } catch (err) {
        setError(err.message);
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [email]);

  return { profile, isLoading, error };
}
