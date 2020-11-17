import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlotPlugin, PlotSeriesConfig } from './types';
import { pluginLog } from './utils';
import uPlot from 'uplot';
import { getTimeZoneInfo, TimeZone } from '@grafana/data';
import { usePlotPluginContext } from './context';

export const usePlotPlugins = () => {
  /**
   * Map of registered plugins (via children)
   * Used to build uPlot plugins config
   */
  const [plugins, setPlugins] = useState<Record<string, PlotPlugin>>({});

  // arePluginsReady determines whether or not all plugins has already registered and uPlot should be initialised
  const [arePluginsReady, setPluginsReady] = useState(false);
  const cancellationToken = useRef<number>();
  const isMounted = useRef(false);

  const checkPluginsReady = useCallback(() => {
    if (cancellationToken.current) {
      window.cancelAnimationFrame(cancellationToken.current);
      cancellationToken.current = undefined;
    }

    /**
     * After registering plugin let's wait for all code to complete to set arePluginsReady to true.
     * If any other plugin will try to register, the previously scheduled call will be canceled
     * and arePluginsReady will be deferred to next animation frame.
     */
    cancellationToken.current = window.requestAnimationFrame(function() {
      if (isMounted.current) {
        setPluginsReady(true);
      }
    });
  }, [cancellationToken, setPluginsReady]);

  const registerPlugin = useCallback(
    (plugin: PlotPlugin) => {
      pluginLog(plugin.id, false, 'register');

      setPlugins(plugs => {
        if (plugs.hasOwnProperty(plugin.id)) {
          throw new Error(`${plugin.id} that is already registered`);
        }

        return {
          ...plugs,
          [plugin.id]: plugin,
        };
      });
      checkPluginsReady();

      return () => {
        setPlugins(p => {
          pluginLog(plugin.id, false, 'unregister');
          delete p[plugin.id];
          return {
            ...p,
          };
        });
      };
    },
    [setPlugins]
  );

  // When uPlot mounts let's check if there are any plugins pending registration
  useEffect(() => {
    checkPluginsReady();
    return () => {
      isMounted.current = false;
      if (cancellationToken.current) {
        window.cancelAnimationFrame(cancellationToken.current);
      }
    };
  }, []);

  return {
    arePluginsReady,
    plugins: plugins || {},
    registerPlugin,
  };
};

export const DEFAULT_PLOT_CONFIG = {
  focus: {
    alpha: 1,
  },
  cursor: {
    focus: {
      prox: 30,
    },
  },
  legend: {
    show: false,
  },
  gutters: {
    x: 8,
    y: 8,
  },
  series: [],
  hooks: {},
};

export const usePlotConfig = (width: number, height: number, timeZone: TimeZone, seriesConfig: PlotSeriesConfig) => {
  const { arePluginsReady, plugins, registerPlugin } = usePlotPlugins();
  const tzDate = useMemo(() => {
    let fmt = undefined;

    const tz = getTimeZoneInfo(timeZone, Date.now())?.ianaName;

    if (tz) {
      fmt = (ts: number) => uPlot.tzDate(new Date(ts * 1e3), tz);
    }

    return fmt;
  }, [timeZone]);

  const [currentConfig, setCurrentConfig] = useState<uPlot.Options>({
    ...DEFAULT_PLOT_CONFIG,
    width,
    height,
    plugins: Object.entries(plugins).map(p => ({
      hooks: p[1].hooks,
    })),
    tzDate,
    ...seriesConfig,
  });

  useEffect(() => {
    setCurrentConfig(c => ({
      ...c,
      ...seriesConfig,
    }));
  }, [seriesConfig]);

  useEffect(() => {
    if (!arePluginsReady) {
      return;
    }

    setCurrentConfig(s => {
      return {
        ...s,
        plugins: Object.entries(plugins).map(p => ({
          hooks: p[1].hooks,
        })),
      };
    });
  }, [arePluginsReady, plugins]);

  return {
    registerPlugin,
    currentConfig,
  };
};

/**
 * Forces re-render of a component when uPlots's draw hook is fired.
 * This hook is usefull in scenarios when you want to reposition XYCanvas elements when i.e. plot size changes
 * @param pluginId - id under which the plugin will be registered
 */
export const useRefreshAfterGraphRendered = (pluginId: string) => {
  const pluginsApi = usePlotPluginContext();
  const [renderToken, setRenderToken] = useState(0);

  useEffect(() => {
    const unregister = pluginsApi.registerPlugin({
      id: pluginId,
      hooks: {
        // refresh events when uPlot draws
        draw: () => {
          setRenderToken(c => c + 1);
          return;
        },
      },
    });

    return () => {
      unregister();
    };
  }, []);

  return renderToken;
};
