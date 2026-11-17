import { useEffect, useState } from 'react';

function TankMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 44 44">
      <path d="M8 27h28l-3 8H11l-3-8Z" fill="currentColor" />
      <path d="M14 20h17l4 7H10l4-7Z" fill="currentColor" opacity=".8" />
      <path d="M19 14h9v6h-9zM27 15h13v3H27z" fill="currentColor" />
      <circle cx="15" cy="32" r="2" fill="#0b100e" />
      <circle cx="22" cy="32" r="2" fill="#0b100e" />
      <circle cx="29" cy="32" r="2" fill="#0b100e" />
    </svg>
  );
}

function ArenaPreview() {
  return (
    <div className="arena-preview" role="img" aria-label="Stylized preview of a future tank arena">
      <div className="radar-ring radar-ring-one" />
      <div className="radar-ring radar-ring-two" />
      <div className="arena-grid" />
      <div className="block block-one" />
      <div className="block block-two" />
      <div className="block block-three" />
      <div className="tank tank-green">
        <span className="tank-barrel" />
        <span className="tank-body" />
        <span className="tank-track" />
      </div>
      <div className="tank tank-orange">
        <span className="tank-barrel" />
        <span className="tank-body" />
        <span className="tank-track" />
      </div>
      <div className="preview-label">
        <span>Sector 01</span>
        <strong>Arena initializing</strong>
      </div>
    </div>
  );
}

function App() {
  const [apiStatus, setApiStatus] = useState('checking');

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/health', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('API unavailable');
        return response.json();
      })
      .then((data) => setApiStatus(data.status === 'ok' ? 'online' : 'offline'))
      .catch((error) => {
        if (error.name !== 'AbortError') setApiStatus('offline');
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#home" aria-label="Tank Battle Arena home">
          <TankMark />
          <span>Tank Battle Arena</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#home">Home</a>
          <a href="#mission">Mission</a>
          <a href="#status">Status</a>
        </nav>
        <div className={`api-pill api-${apiStatus}`} title="Express API connection status">
          <span />
          API {apiStatus}
        </div>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy">
            <p className="eyebrow"><span>UB CSE 312</span> Multiplayer browser arena</p>
            <h1>Roll in.<br /><em>Own the arena.</em></h1>
            <p className="hero-description">
              A fast, tactical tank battle built for the browser. The battlefield is under
              construction—your crew will be called in soon.
            </p>
            <div className="hero-actions">
              <button className="play-button" type="button" disabled>
                <span className="play-icon">▶</span>
                Play
                <small>Coming soon</small>
              </button>
              <a className="text-link" href="#mission">View the mission <span>↘</span></a>
            </div>
            <div className="build-meta">
              <span>Objective 01</span>
              <span className="meta-rule" />
              <span>Foundation build</span>
            </div>
          </div>
          <ArenaPreview />
        </section>

        <section className="mission" id="mission">
          <div>
            <p className="section-number">01 / Mission brief</p>
            <h2>Built for quick battles and bold moves.</h2>
          </div>
          <p>
            Tank Battle Arena is being designed as a real-time multiplayer experience where
            positioning, timing, and teamwork decide who controls the map. This first release
            establishes the local application foundation; combat systems arrive in a future objective.
          </p>
        </section>

        <section className="status-section" id="status">
          <div className="status-heading">
            <p className="section-number">02 / Development status</p>
            <h2>The garage is open.</h2>
          </div>
          <div className="status-cards">
            <article>
              <span className="card-index">A</span>
              <h3>Web command</h3>
              <p>Responsive React interface ready to become the game lobby and launch point.</p>
              <span className="card-state">Established</span>
            </article>
            <article>
              <span className="card-index">B</span>
              <h3>API relay</h3>
              <p>Express service routed through one local nginx entry point.</p>
              <span className="card-state">Established</span>
            </article>
            <article className="future-card">
              <span className="card-index">C</span>
              <h3>Battle systems</h3>
              <p>Gameplay, live matches, and player accounts are deliberately reserved for later.</p>
              <span className="card-state">Next objectives</span>
            </article>
          </div>
        </section>
      </main>

      <footer>
        <a className="brand footer-brand" href="#home"><TankMark /><span>Tank Battle Arena</span></a>
        <p>University at Buffalo · CSE 312</p>
        <p>Local foundation build</p>
      </footer>
    </div>
  );
}

export default App;

