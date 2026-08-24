import { FileBrowser } from '@/components/files/FileBrowser';

export const metadata = { title: 'Trash' };

export default function TrashPage() {
  return (
    <FileBrowser
      emptyState={{
        title: 'The trash is empty',
        body: 'Deleted files rest here for 30 days — they still count against your quota until they are purged.',
        seed: 37,
      }}
    />
  );
}
