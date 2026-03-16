import { NavLink } from 'react-router-dom';

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/credential', label: 'Credential' },
  { to: '/deposit', label: 'Deposit' },
  { to: '/transfer', label: 'Transfer' },
  { to: '/withdraw', label: 'Withdraw' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/compliance', label: 'Compliance' },
];

export function Navbar() {
  return (
    <header className="nav-shell">
      <nav className="nav" aria-label="Primary">
        <NavLink to="/" className="brand" end>
          <span className="brand-word">VaultProof</span>
          <span className="brand-subtitle">Confidential Compliance Infrastructure</span>
        </NavLink>

        <div className="nav-links">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        <div className="nav-status">
          <span className="chip chip-accent">Devnet read mode</span>
        </div>
      </nav>
    </header>
  );
}
