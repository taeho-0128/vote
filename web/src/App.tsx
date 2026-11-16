import { AppBar, Notice } from './components/Frame.tsx';
import { useRoute } from './route.ts';
import { HostScreen } from './screens/HostScreen.tsx';
import { Home } from './screens/Home.tsx';
import { ParticipantScreen } from './screens/ParticipantScreen.tsx';

export function App() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'participant':
      return <ParticipantScreen key={route.code} code={route.code} />;
    case 'host':
      return <HostScreen key={route.code} code={route.code} />;
    case 'not-found':
      return (
        <div className="app">
          <AppBar />
          <main className="column">
            <Notice testId="not-found" title="페이지를 찾을 수 없어요" message="주소를 다시 확인해 주세요." />
          </main>
        </div>
      );
  }
}
