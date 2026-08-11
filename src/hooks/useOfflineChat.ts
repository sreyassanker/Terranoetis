import { useEffect, useState } from 'react';
import { useChatStore } from '@/store/chatStore';
import { isOnline, getQueuedMessages, addOnlineListener } from '@/lib/offlineChat';

export function useOfflineChat() {
  const sessionId = useChatStore(state => state.sessionId);
  const [online, setOnline] = useState<boolean>(() => isOnline());
  const [queuedCount, setQueuedCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      if (!mounted) return;
      const queued = await getQueuedMessages();
      if (mounted) setQueuedCount(queued.length);
    };

    const handleOnline = () => {
      if (mounted) setOnline(true);
      refresh();
    };

    const unsubscribe = addOnlineListener((isNowOnline) => {
      if (mounted) setOnline(isNowOnline);
      refresh();
    });

    refresh();
    window.addEventListener('online', handleOnline);

    return () => {
      mounted = false;
      unsubscribe();
      window.removeEventListener('online', handleOnline);
    };
  }, [sessionId]);

  return {
    isOnline: online,
    queuedCount,
  };
}