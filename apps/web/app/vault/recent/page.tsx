import { FileBrowser } from '@/components/files/FileBrowser';

export const metadata = { title: 'Recent' };

export default function RecentPage() {
  return (
    <FileBrowser
      emptyState={{ title: 'Nothing recent', body: 'Files you add will appear here, newest first.', seed: 23 }}
    />
  );
}
