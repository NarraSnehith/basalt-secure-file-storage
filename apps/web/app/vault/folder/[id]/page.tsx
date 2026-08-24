import { FileBrowser } from '@/components/files/FileBrowser';

export default function FolderPage() {
  return (
    <FileBrowser
      emptyState={{
        title: 'Nothing in this folder yet',
        body: 'Drop files here, or drag them onto the folder in the sidebar from anywhere in your drive.',
        seed: 13,
      }}
    />
  );
}
