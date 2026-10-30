// Use the approved database profile, never editable auth metadata, for routing.
export async function accountWorkspace(db, user, profile) {
  if (!user) return {kind:'login'};
  if (!profile) {
    const {data,error}=await db.from('profiles').select('*').eq('id',user.id).single();
    if (error) throw error;
    profile=data;
  }
  if (!profile?.account_active) return {kind:'denied',profile};
  if (profile.role==='Clinician') return {kind:'doctor',profile};
  if (profile.role==='Administrator') return {kind:'admin',profile};
  const {data,error}=await db.rpc('list_my_managed_centers');
  if (error) throw error;
  return {kind:data?.length?'center':'denied',profile,centers:data||[]};
}
