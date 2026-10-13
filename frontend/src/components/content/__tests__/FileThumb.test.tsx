import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { FileThumb } from '../FileThumb';

describe('FileThumb', () => {
  it('renders the image with the file name as alt text', () => {
    renderWithProviders(
      <FileThumb url="http://localhost:3000/uploads/files/a.png" filename="photo.png" mimeType="image/png" />,
    );
    expect(screen.getByAltText('photo.png')).toBeInTheDocument();
  });

  it('falls back to a labelled icon when the image fails to load', () => {
    renderWithProviders(
      <FileThumb url="http://localhost:3000/uploads/files/broken.png" filename="broken.png" mimeType="image/png" />,
    );
    const img = screen.getByAltText('broken.png');
    fireEvent.error(img);
    expect(screen.getByLabelText('File: broken.png')).toBeInTheDocument();
  });

  it('renders PDFs as a labelled document without an image', () => {
    renderWithProviders(
      <FileThumb url="http://localhost:3000/uploads/files/doc.pdf" filename="doc.pdf" mimeType="application/pdf" />,
    );
    expect(screen.getByLabelText('File: doc.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
