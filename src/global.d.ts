import type { BridgeApi } from '../shared/api';
import type { JSX as ReactJSX } from 'react';

declare global {
  interface Window {
    api: BridgeApi;
  }
  // React 19 removed the global JSX namespace; mirror it from React so existing
  // `JSX.Element` return types compile.
  namespace JSX {
    type Element = ReactJSX.Element;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
    type ElementClass = ReactJSX.ElementClass;
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
    type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
  }
}

export {};
