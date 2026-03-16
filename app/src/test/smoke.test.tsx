import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App, { AppShell } from '../App';

describe('VaultProof app shell', () => {
  it('renders the real navigation instead of the Vite starter', async () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /^home$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^credential$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^deposit$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^transfer$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^withdraw$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^compliance$/i })).toBeInTheDocument();
    expect(screen.getByText(/compliant stablecoins with confidential identity/i)).toBeInTheDocument();
    expect(screen.queryByText(/get started/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/count is/i)).not.toBeInTheDocument();
  });

  it('mounts the browser app without crashing', () => {
    render(<App />);

    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument();
  });

  it('renders the deposit route content', () => {
    render(
      <MemoryRouter initialEntries={['/deposit']}>
        <AppShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /deposit into the vault/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate proof and deposit/i })).toBeInTheDocument();
  });
});
