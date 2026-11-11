import { Component, type ReactNode } from "react";
export default class DocumentBoundary extends Component<
  { children: ReactNode; onSource: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="document-failed">
          <h2>Не удалось показать этот файл</h2>
          <p>Исходное содержимое сохранено. Его можно открыть в режиме исходного кода.</p>
          <button className="primary" onClick={this.props.onSource}>
            Открыть исходный код
          </button>
        </div>
      );
    return this.props.children;
  }
}
