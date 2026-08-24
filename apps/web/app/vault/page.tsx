import { FileBrowser } from '@/components/files/FileBrowser';

export default function DrivePage() {
  return (
    <FileBrowser
      emptyState={{
        title: 'Your drive is empty',
        body: 'Drop files anywhere on this page, press U, or use the upload button. Files stay private until you share them.',
        seed: 5,
      }}
    />
  );
}
