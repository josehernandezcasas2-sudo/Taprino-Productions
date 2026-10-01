import { Image } from 'react-native';
import { SvgUri } from 'react-native-svg';

// A drop-in replacement for <Image source={{ uri }}> wherever `uri` might
// be CMS/placeholder artwork (thumbnail/poster/heroImage/titleImageUrl) —
// those fields can hold a `data:image/svg+xml;base64,...` URI for content
// that hasn't had real art uploaded yet (see lib/placeholderContent.js on
// the website). React Native's core <Image> only decodes raster formats
// (PNG/JPEG), never SVG, even as a data URI — it fails silently, which is
// why this was invisible in the web preview (browsers DO render SVG data
// URIs in a plain <img>, masking the bug there). react-native-svg's
// <SvgUri> fetches and parses the URI itself (its fetch() goes through a
// standard data: URI fine) and actually renders the SVG natively.
export default function SmartImage({ uri, style, ...rest }) {
  if (!uri) return null;
  if (uri.startsWith('data:image/svg+xml')) {
    // No explicit width/height props here — react-native-svg's <Svg> (which
    // SvgUri wraps) lets props override `style`, and a bare "100%" prop
    // doesn't resolve against this box the way RN style percentages do.
    // `style` alone (a fixed {width, height} for cards, or
    // absoluteFillObject for the hero) sizes it correctly, same as Image.
    return <SvgUri uri={uri} style={style} preserveAspectRatio="xMidYMid slice" />;
  }
  return <Image source={{ uri }} style={style} {...rest} />;
}
