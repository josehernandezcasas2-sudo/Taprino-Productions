import { useState } from 'react';
import { Image, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

// A drop-in replacement for <Image source={{ uri }}> wherever `uri` might
// be CMS/placeholder artwork (thumbnail/poster/heroImage/titleImageUrl) —
// those fields can hold a `data:image/svg+xml;base64,...` URI for content
// that hasn't had real art uploaded yet (see lib/placeholderContent.js on
// the website). React Native's core <Image> only decodes raster formats
// (PNG/JPEG), never SVG, even as a data URI — it fails silently, which is
// why this was invisible in the web preview (browsers DO render SVG data
// URIs in a plain <img>, masking the bug there). react-native-svg's
// <SvgUri> fetches and parses the URI itself and draws the SVG natively.
//
// SvgUri needs real pixel width/height to scale its viewBox (an absolute-
// fill style has neither, and a "100%" prop doesn't resolve against the
// box the way RN style percentages do — both made the art render at its
// native 640x360 from the top-left corner, cropping out the centered
// label). So the SVG branch renders the caller's `style` on a plain View,
// measures it, and hands those exact pixels to SvgUri with "slice" scaling
// (= resizeMode "cover").
function SvgArt({ uri, style }) {
  const [size, setSize] = useState(null);
  return (
    <View
      style={[style, { overflow: 'hidden' }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (width > 0 && height > 0) setSize({ width, height });
      }}
    >
      {size ? <SvgUri uri={uri} width={size.width} height={size.height} preserveAspectRatio="xMidYMid slice" /> : null}
    </View>
  );
}

export default function SmartImage({ uri, style, ...rest }) {
  if (!uri) return null;
  if (uri.startsWith('data:image/svg+xml')) return <SvgArt uri={uri} style={style} />;
  return <Image source={{ uri }} style={style} {...rest} />;
}
