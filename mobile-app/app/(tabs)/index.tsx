import { useAuth } from '../../lib/AuthContext';
import { LoadingView } from '../../components/StateViews';
import PatientHome from '../../components/PatientHome';
import DoctorHome from '../../components/DoctorHome';
import AdminHome from '../../components/AdminHome';

export default function HomeScreen() {
  const { profile, loading } = useAuth();

  if (loading || !profile) return <LoadingView message="Loading your account..." />;

  if (profile.role === 'DOCTOR') {
    return <DoctorHome profile={profile} />;
  }

  if (profile.role === 'ADMIN') {
    return <AdminHome profile={profile} />;
  }

  return <PatientHome profile={profile} />;
}  