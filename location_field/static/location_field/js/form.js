var SequentialLoader = function() {
    var SL = {
        loadJS: function(src, onload) {
            this._load_pending.push({'src': src, 'onload': onload});
            if (!this._loading) {
                this._loading = true;
                this.loadNextJS();
            }
        },

        loadNextJS: function() {
            var next = this._load_pending.shift();
            if (next == undefined) {
                this._loading = false;
                return;
            }
            if (this._load_cache[next.src] != undefined) {
                next.onload();
                this.loadNextJS();
                return;
            }
            this._load_cache[next.src] = 1;

            var el = document.createElement('script');
            el.type = 'application/javascript';
            el.src = next.src;

            var self = this;
            el.onload = function(){
                next.onload();
                self.loadNextJS();
            };
            document.body.appendChild(el);
        },

        _loading: false,
        _load_pending: [],
        _load_cache: {}
    };

    return {
        loadJS: SL.loadJS.bind(SL)
    };
};


!function($){
    var LocationFieldResourceLoader;

    function LatLng(lat, lng) {
        this.lat = parseFloat(lat) || 0;
        this.lng = parseFloat(lng) || 0;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function requestJSON(url, onload, onerror) {
        var request = new XMLHttpRequest();
        request.open('GET', url, true);
        request.onload = function() {
            if (request.status >= 200 && request.status < 400) {
                onload(JSON.parse(request.responseText));
            }
            else if (onerror) {
                onerror();
            }
        };
        request.onerror = onerror || function(){};
        request.send();
    }

    function TileMap(element, options, providerOptions) {
        this.element = element;
        this.provider = options.provider;
        this.providerOptions = providerOptions || {};
        this.center = options.center;
        this.maxZoom = options.maxZoom == null ? 18 : options.maxZoom;
        this.zoom = clamp(options.zoom == null ? 13 : options.zoom, 0, this.maxZoom);
        this.tiles = {};
        this.marker = null;
        this.onClick = null;
        this.dragging = false;

        this._render();
        this._bindEvents();
        this._draw();
    }

    TileMap.prototype = {
        _render: function() {
            this.element.style.position = 'relative';
            this.element.style.overflow = 'hidden';
            this.element.style.background = '#e5e3df';
            this.element.style.cursor = 'grab';
            this.element.style.touchAction = 'none';
            this.element.tabIndex = 0;
            this.element.setAttribute('aria-label', 'Location map');
            this.element.innerHTML = '';

            this.tilePane = document.createElement('div');
            this.tilePane.style.position = 'absolute';
            this.tilePane.style.inset = '0';
            this.element.appendChild(this.tilePane);

            this.controls = document.createElement('div');
            this.controls.style.position = 'absolute';
            this.controls.style.top = '10px';
            this.controls.style.left = '10px';
            this.controls.style.zIndex = '3';
            this.controls.style.display = 'grid';
            this.controls.style.border = '1px solid #aaa';
            this.controls.style.background = '#fff';
            this.controls.style.boxShadow = '0 1px 4px rgba(0,0,0,.3)';
            this.element.appendChild(this.controls);

            this._addZoomButton('+', 1);
            this._addZoomButton('-', -1);


            if (this.provider === 'openstreetmap') {
                var attribution = document.createElement('div');
                attribution.className = 'location-field-attribution';
                attribution.style.position = 'absolute';
                attribution.style.bottom = '0';
                attribution.style.right = '0';
                attribution.style.zIndex = '3';
                attribution.style.padding = '2px 5px';
                attribution.style.background = 'rgba(255,255,255,0.9)';
                attribution.style.color = '#222';
                attribution.style.font = '12px/1.4 Arial, sans-serif';
                attribution.style.cursor = 'auto';
                attribution.appendChild(document.createTextNode('© '));
                var link = document.createElement('a');
                link.href = 'https://www.openstreetmap.org/copyright';
                link.textContent = 'OpenStreetMap contributors';
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.style.color = '#005a8c';
                link.style.textDecoration = 'underline';
                attribution.appendChild(link);
                // Following the attribution must not move the map or select a location.
                ['click', 'mousedown', 'touchstart', 'keydown', 'wheel'].forEach(function(type) {
                    attribution.addEventListener(type, function(event) {
                        event.stopPropagation();
                    });
                });
                this.element.appendChild(attribution);
            }
        },

        _addZoomButton: function(label, delta) {
            var self = this;
            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.title = delta > 0 ? 'Zoom in' : 'Zoom out';
            button.setAttribute('aria-label', button.title);
            button.style.width = '28px';
            button.style.height = '28px';
            button.style.border = '0';
            button.style.borderBottom = delta > 0 ? '1px solid #ccc' : '0';
            button.style.background = '#fff';
            button.style.font = 'bold 18px/1 Arial, sans-serif';
            button.style.cursor = 'pointer';
            button.onclick = function(event) {
                event.preventDefault();
                self.setZoom(self.zoom + delta);
            };
            this.controls.appendChild(button);
        },

        _bindEvents: function() {
            var self = this;
            var eventPoint = function(event) {
                var pointEvent = event.touches && event.touches.length ? event.touches[0] : event;
                return {x: pointEvent.clientX, y: pointEvent.clientY};
            };

            this.element.addEventListener('click', function(event) {
                if (self.dragging || Date.now() < self.suppressClickUntil) {
                    return;
                }
                if (self.controls.contains(event.target) || (self.marker && self.marker.element.contains(event.target))) {
                    return;
                }
                if (self.onClick) {
                    var point = self.eventPoint(event);
                    self.onClick(self.containerPointToLatLng(point.x, point.y));
                }
            });

            this.element.addEventListener('mousedown', function(event) {
                if (event.button !== 0 || self.controls.contains(event.target) || self.markerDragging) {
                    return;
                }
                var point = eventPoint(event);
                self.element.focus({preventScroll: true});
                self.dragStart = {x: point.x, y: point.y, center: self.project(self.center)};
                self.element.style.cursor = 'grabbing';
            });

            this.element.addEventListener('touchstart', function(event) {
                if (self.controls.contains(event.target) || self.markerDragging) {
                    return;
                }
                if (event.touches.length === 2) {
                    var a = self.eventPoint(event.touches[0]);
                    var b = self.eventPoint(event.touches[1]);
                    self.pinch = {
                        distance: Math.hypot(b.x - a.x, b.y - a.y),
                        zoom: self.zoom,
                        anchor: self.containerPointToLatLng((a.x + b.x) / 2, (a.y + b.y) / 2)
                    };
                    self.dragStart = null;
                    self.dragging = true;
                }
                else if (event.touches.length === 1) {
                    var point = eventPoint(event);
                    self.dragStart = {x: point.x, y: point.y, center: self.project(self.center)};
                }
            });

            var moveMap = function(event) {
                if (self.pinch && event.touches && event.touches.length === 2) {
                    event.preventDefault();
                    var a = self.eventPoint(event.touches[0]);
                    var b = self.eventPoint(event.touches[1]);
                    var distance = Math.hypot(b.x - a.x, b.y - a.y);
                    if (distance > 0 && self.pinch.distance > 0) {
                        self.zoom = clamp(Math.round(self.pinch.zoom + Math.log2(distance / self.pinch.distance)), 0, self.maxZoom);
                        self._centerOnAnchor(self.pinch.anchor, {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2});
                        self._draw();
                    }
                    return;
                }
                if (!self.dragStart || self.markerDragging) {
                    return;
                }
                var point = eventPoint(event);
                var dx = point.x - self.dragStart.x;
                var dy = point.y - self.dragStart.y;
                if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
                    self.dragging = true;
                }
                if (event.touches && self.dragging) {
                    event.preventDefault();
                }
                self.center = self.unproject({
                    x: self.dragStart.center.x - dx,
                    y: self.dragStart.center.y - dy
                });
                self._draw();
            };

            var stopMap = function(event) {
                if (!self.dragStart && !self.pinch) {
                    return;
                }
                if (self.dragging) {
                    self.suppressClickUntil = Date.now() + 400;
                }
                self.pinch = null;
                if (event.type === 'touchend' && event.touches.length === 1) {
                    var point = eventPoint(event);
                    self.dragStart = {x: point.x, y: point.y, center: self.project(self.center)};
                    return;
                }
                self.dragStart = null;
                self.element.style.cursor = 'grab';
                setTimeout(function(){ self.dragging = false; }, 0);
            };

            document.addEventListener('mousemove', moveMap);
            document.addEventListener('touchmove', moveMap, {passive: false});
            document.addEventListener('mouseup', stopMap);
            document.addEventListener('touchend', stopMap);
            document.addEventListener('touchcancel', stopMap);

            this.element.addEventListener('wheel', function(event) {
                event.preventDefault();
                if (event.deltaY) {
                    self.setZoom(self.zoom + (event.deltaY < 0 ? 1 : -1), self.eventPoint(event));
                }
            }, {passive: false});

            this.element.addEventListener('dblclick', function(event) {
                if (self.controls.contains(event.target) || (self.marker && self.marker.element.contains(event.target))) {
                    return;
                }
                event.preventDefault();
                self.setZoom(self.zoom + (event.shiftKey ? -1 : 1), self.eventPoint(event));
            });

            this.element.addEventListener('keydown', function(event) {
                if (event.target !== self.element || event.altKey || event.ctrlKey || event.metaKey) {
                    return;
                }
                var offsets = {ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80]};
                var offset = offsets[event.key];
                if (offset) {
                    var center = self.project(self.center);
                    self.panTo(self.unproject({x: center.x + offset[0], y: center.y + offset[1]}));
                }
                else if (event.key === '+' || event.key === '=' || event.key === '-') {
                    self.setZoom(self.zoom + (event.key === '-' ? -1 : 1));
                }
                else {
                    return;
                }
                event.preventDefault();
            });
        },

        eventPoint: function(event) {
            var rect = this.element.getBoundingClientRect();
            return {x: event.clientX - rect.left - this.element.clientLeft, y: event.clientY - rect.top - this.element.clientTop};
        },

        _tileUrl: function(x, y, z) {
            if (this.provider === 'mapbox') {
                var id = this.providerOptions.id || 'mapbox/streets-v11';
                if (id === 'mapbox.streets') {
                    id = 'mapbox/streets-v11';
                }
                return 'https://api.mapbox.com/styles/v1/' + id + '/tiles/256/' + z + '/' + x + '/' + y + '?access_token=' + encodeURIComponent(this.providerOptions.access_token);
            }
            return 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';
        },

        _draw: function() {
            var width = this.element.clientWidth;
            var height = this.element.clientHeight;
            var center = this.project(this.center);
            var topLeft = {x: center.x - width / 2, y: center.y - height / 2};
            var tileSize = 256;
            var firstX = Math.floor(topLeft.x / tileSize);
            var firstY = Math.floor(topLeft.y / tileSize);
            var lastX = Math.floor((topLeft.x + width) / tileSize);
            var lastY = Math.floor((topLeft.y + height) / tileSize);
            var limit = Math.pow(2, this.zoom);

            var visible = {};
            for (var x = firstX; x <= lastX; x++) {
                for (var y = firstY; y <= lastY; y++) {
                    if (y < 0 || y >= limit) {
                        continue;
                    }
                    var wrappedX = ((x % limit) + limit) % limit;
                    var key = this.zoom + '/' + x + '/' + y;
                    visible[key] = true;
                    var img = this.tiles[key];
                    if (!img) {
                        img = document.createElement('img');
                        img.draggable = false;
                        img.alt = '';
                        if (this.provider === 'openstreetmap') {
                            // OSM needs a Referer; disclose only the origin, not admin paths.
                            img.referrerPolicy = 'strict-origin-when-cross-origin';
                        }
                        img.src = this._tileUrl(wrappedX, y, this.zoom);
                        img.style.position = 'absolute';
                        img.style.width = tileSize + 'px';
                        img.style.height = tileSize + 'px';
                        img.style.maxWidth = 'none';
                        this.tiles[key] = img;
                        this.tilePane.appendChild(img);
                    }
                    img.style.left = (x * tileSize - topLeft.x) + 'px';
                    img.style.top = (y * tileSize - topLeft.y) + 'px';
                }
            }

            for (var key in this.tiles) {
                if (!visible[key]) {
                    this.tilePane.removeChild(this.tiles[key]);
                    delete this.tiles[key];
                }
            }

            if (this.marker) {
                this.marker._position();
            }
        },

        project: function(latLng) {
            var siny = clamp(Math.sin(latLng.lat * Math.PI / 180), -0.9999, 0.9999);
            var scale = 256 * Math.pow(2, this.zoom);
            return {
                x: scale * (0.5 + latLng.lng / 360),
                y: scale * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI))
            };
        },

        unproject: function(point) {
            var scale = 256 * Math.pow(2, this.zoom);
            var lng = (point.x / scale - 0.5) * 360;
            var lat = (2 * Math.atan(Math.exp((0.5 - point.y / scale) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;
            return new LatLng(lat, lng);
        },

        containerPointToLatLng: function(x, y) {
            var center = this.project(this.center);
            return this.unproject({
                x: center.x - this.element.clientWidth / 2 + x,
                y: center.y - this.element.clientHeight / 2 + y
            });
        },

        latLngToContainerPoint: function(latLng) {
            var center = this.project(this.center);
            var point = this.project(latLng);
            return {
                x: point.x - center.x + this.element.clientWidth / 2,
                y: point.y - center.y + this.element.clientHeight / 2
            };
        },

        _centerOnAnchor: function(anchor, point) {
            var projected = this.project(anchor);
            this.center = this.unproject({
                x: projected.x - point.x + this.element.clientWidth / 2,
                y: projected.y - point.y + this.element.clientHeight / 2
            });
        },

        setZoom: function(zoom, point) {
            var nextZoom = clamp(zoom, 0, this.maxZoom);
            if (nextZoom === this.zoom) {
                return;
            }
            var anchor = point && this.containerPointToLatLng(point.x, point.y);
            this.zoom = nextZoom;
            if (anchor) {
                this._centerOnAnchor(anchor, point);
            }
            this._draw();
        },

        panTo: function(latLng) {
            this.center = latLng;
            this._draw();
        },

        setMarker: function(marker) {
            this.marker = marker;
        }
    };

    function TileMarker(map, latLng, onChange) {
        this.map = map;
        this.latLng = latLng;
        this.onChange = onChange;
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.element.style.width = '25px';
        this.element.style.height = '41px';
        this.element.style.marginLeft = '-12px';
        this.element.style.marginTop = '-41px';
        this.element.style.zIndex = '2';
        this.element.style.cursor = 'move';
        this.element.style.background = 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2725%27 height=%2741%27 viewBox=%270 0 25 41%27%3E%3Cpath fill=%27%232a81cb%27 stroke=%27%231b4f87%27 d=%27M12.5 1C6.2 1 1 6.2 1 12.6 1 21.2 12.5 40 12.5 40S24 21.2 24 12.6C24 6.2 18.8 1 12.5 1z%27/%3E%3Ccircle cx=%2712.5%27 cy=%2712.5%27 r=%275%27 fill=%27white%27/%3E%3C/svg%3E") center / contain no-repeat';

        map.element.appendChild(this.element);
        map.setMarker(this);
        this._bindEvents();
        this._position();
    }

    TileMarker.prototype = {
        _bindEvents: function() {
            var self = this;
            var eventPoint = function(event) {
                var pointEvent = event.touches && event.touches.length ? event.touches[0] : event;
                return {x: pointEvent.clientX, y: pointEvent.clientY};
            };
            this.element.addEventListener('mousedown', function(event) {
                if (event.button !== 0) {
                    return;
                }
                event.preventDefault();
                self.map.markerDragging = true;
            });
            this.element.addEventListener('touchstart', function(event) {
                event.preventDefault();
                self.map.markerDragging = true;
            });
            var moveMarker = function(event) {
                if (!self.map.markerDragging) {
                    return;
                }
                var point = eventPoint(event);
                var local = self.map.eventPoint({clientX: point.x, clientY: point.y});
                if (event.touches) {
                    event.preventDefault();
                }
                self.setPosition(self.map.containerPointToLatLng(local.x, local.y));
            };
            var stopMarker = function() {
                if (self.map.markerDragging) {
                    self.map.suppressClickUntil = Date.now() + 400;
                }
                self.map.markerDragging = false;
            };
            document.addEventListener('mousemove', moveMarker);
            document.addEventListener('touchmove', moveMarker, {passive: false});
            document.addEventListener('mouseup', stopMarker);
            document.addEventListener('touchend', stopMarker);
            document.addEventListener('touchcancel', stopMarker);
        },

        _position: function() {
            var point = this.map.latLngToContainerPoint(this.latLng);
            this.element.style.left = point.x + 'px';
            this.element.style.top = point.y + 'px';
        },

        setPosition: function(latLng) {
            this.latLng = latLng;
            this._position();
            this.onChange(latLng);
        }
    };

    function GoogleMapAdapter(element, options, providerOptions) {
        this.map = new google.maps.Map(element, {
            center: options.center,
            zoom: options.zoom,
            mapTypeId: (providerOptions.mapType || 'ROADMAP').toLowerCase()
        });
    }

    GoogleMapAdapter.prototype = {
        panTo: function(latLng) {
            this.map.panTo(latLng);
        },

        onClick: function(callback) {
            this.map.addListener('click', function(event) {
                callback(new LatLng(event.latLng.lat(), event.latLng.lng()));
            });
        },

        createMarker: function(latLng, onChange) {
            var marker = new google.maps.Marker({
                map: this.map,
                position: latLng,
                draggable: true
            });
            marker.addListener('dragend', function() {
                var position = marker.getPosition();
                onChange(new LatLng(position.lat(), position.lng()));
            });
            return {
                setPosition: function(nextLatLng) {
                    marker.setPosition(nextLatLng);
                    onChange(nextLatLng);
                }
            };
        }
    };

    function TileMapAdapter(element, options, providerOptions) {
        this.map = new TileMap(element, options, providerOptions);
    }

    TileMapAdapter.prototype = {
        panTo: function(latLng) {
            this.map.panTo(latLng);
        },

        onClick: function(callback) {
            this.map.onClick = callback;
        },

        createMarker: function(latLng, onChange) {
            var marker = new TileMarker(this.map, latLng, onChange);
            return {
                setPosition: function(nextLatLng) {
                    marker.setPosition(nextLatLng);
                }
            };
        }
    };

    $.locationField = function(options) {
        var LocationField = {
            options: $.extend({
                provider: 'google',
                providerOptions: {
                    google: {
                        api: '//maps.google.com/maps/api/js',
                        mapType: 'ROADMAP'
                    }
                },
                searchProvider: 'google',
                id: 'map',
                latLng: '0,0',
                mapOptions: {
                    zoom: 9
                },
                basedFields: $(),
                inputField: $(),
                suffix: '',
                path: ''
            }, options),

            providers: /^(google|openstreetmap|mapbox)$/,
            searchProviders: /^(google|yandex|nominatim|addok)$/,

            render: function() {
                this.$id = $('#' + this.options.id);

                if (!this.providers.test(this.options.provider)) {
                    this.error('render failed, invalid map provider: ' + this.options.provider);
                    return;
                }

                if (!this.searchProviders.test(this.options.searchProvider)) {
                    this.error('render failed, invalid search provider: ' + this.options.searchProvider);
                    return;
                }

                var self = this;
                this.loadAll(function(){
                    var mapOptions = self._getMapOptions();
                    var map = self._getMap(mapOptions);
                    var marker = map.createMarker(mapOptions.center, function(latLng) {
                        self.fill(latLng);
                    });

                    map.onClick(function(latLng) {
                        marker.setPosition(latLng);
                    });

                    self._watchBasedFields(map, marker);
                });
            },

            fill: function(latLng) {
                this.options.inputField.val(latLng.lat + ',' + latLng.lng);
            },

            search: function(map, marker, address) {
                address = address + (this.options.suffix ? ', ' + this.options.suffix : '');
                if (!address.replace(/,\s*/g, '').length) {
                    return;
                }

                var self = this;
                var setLocation = function(latLng) {
                    marker.setPosition(latLng);
                    map.panTo(latLng);
                };

                if (this.options.searchProvider === 'google') {
                    var geocoder = new google.maps.Geocoder();
                    geocoder.geocode({address: address}, function(results, status) {
                        if (status === 'OK' && results.length > 0) {
                            var location = results[0].geometry.location;
                            setLocation(new LatLng(location.lat(), location.lng()));
                        }
                        else {
                            console.error('Google geocoder error response: ' + status);
                        }
                    });
                }
                else if (this.options.searchProvider === 'yandex') {
                    var url = 'https://geocode-maps.yandex.ru/1.x/?format=json&geocode=' + encodeURIComponent(address);

                    if (typeof this.options.providerOptions.yandex.apiKey !== 'undefined') {
                        url += '&apikey=' + encodeURIComponent(this.options.providerOptions.yandex.apiKey);
                    }

                    requestJSON(url, function(data) {
                        var member = data.response.GeoObjectCollection.featureMember[0];
                        if (member) {
                            var pos = member.GeoObject.Point.pos.split(' ');
                            setLocation(new LatLng(pos[1], pos[0]));
                        }
                    }, function() {
                        console.error('Yandex geocoder error response');
                    });
                }
                else if (this.options.searchProvider === 'addok') {
                    requestJSON('https://api-adresse.data.gouv.fr/search/?limit=1&q=' + encodeURIComponent(address), function(data) {
                        if (data.features && data.features.length > 0) {
                            var pos = data.features[0].geometry.coordinates;
                            setLocation(new LatLng(pos[1], pos[0]));
                        }
                    }, function() {
                        console.error('Addok geocoder error response');
                    });
                }
                else if (this.options.searchProvider === 'nominatim') {
                    requestJSON('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(address), function(data) {
                        if (data.length > 0) {
                            setLocation(new LatLng(data[0].lat, data[0].lon));
                        }
                        else {
                            console.error(address + ': not found via Nominatim');
                        }
                    }, function() {
                        console.error('Nominatim geocoder error response');
                    });
                }
            },

            loadAll: function(onload) {
                this.$id.html('Loading...');

                if (LocationFieldResourceLoader == undefined) {
                    LocationFieldResourceLoader = SequentialLoader();
                }

                this.load.loader = LocationFieldResourceLoader;
                this.load.path = this.options.path;

                var self = this;
                var mapProvider = self.options.provider;
                var loadSearchProvider = function() {
                    if (self.options.searchProvider === 'google' && mapProvider !== 'google') {
                        self.load.google(self.options.providerOptions.google || {}, function() {
                            self.$id.html('');
                            onload();
                        });
                    }
                    else {
                        self.$id.html('');
                        onload();
                    }
                };

                if (self.load[mapProvider] != undefined) {
                    self.load[mapProvider](self.options.providerOptions[mapProvider] || {}, loadSearchProvider);
                }
                else {
                    loadSearchProvider();
                }
            },

            load: {
                google: function(options, onload) {
                    this._loadJSList([this.path + '/@googlemaps/js-api-loader/index.min.js'], function(){
                        var loader = new google.maps.plugins.loader.Loader({
                            apiKey: options.apiKey,
                            version: 'weekly'
                        });
                        loader.load().then(function() {
                            onload();
                        });
                    });
                },

                mapbox: function(options, onload) {
                    onload();
                },

                openstreetmap: function(options, onload) {
                    onload();
                },

                _loadJS: function(src, onload) {
                    this.loader.loadJS(src, onload);
                },

                _loadJSList: function(srclist, onload) {
                    if (srclist.length === 0) {
                        onload();
                        return;
                    }
                    for (var i = 0; i < srclist.length - 1; ++i) {
                        this._loadJS(srclist[i], function(){});
                    }
                    this._loadJS(srclist[srclist.length - 1], onload);
                }
            },

            error: function(message) {
                console.log(message);
                this.$id.html(message);
            },

            _getMap: function(mapOptions) {
                var element = document.getElementById(this.options.id);
                if (this.options.provider === 'google') {
                    return new GoogleMapAdapter(element, mapOptions, this.options.providerOptions.google);
                }
                return new TileMapAdapter(element, $.extend(mapOptions, {
                    provider: this.options.provider,
                    maxZoom: this.options.providerOptions[this.options.provider].maxZoom
                }), this.options.providerOptions[this.options.provider]);
            },

            _getMapOptions: function() {
                return $.extend(this.options.mapOptions, {
                    center: this._getLatLng()
                });
            },

            _getLatLng: function() {
                var l = this.options.latLng.split(',').map(parseFloat);
                return new LatLng(l[0], l[1]);
            },

            _watchBasedFields: function(map, marker) {
                var self = this;
                var basedFields = this.options.basedFields;
                var onchangeTimer;
                var onchange = function() {
                    var values = basedFields.map(function() {
                        var value = $(this).val();
                        return value === '' ? null : value;
                    });
                    var address = values.toArray().join(', ');
                    clearTimeout(onchangeTimer);
                    onchangeTimer = setTimeout(function(){
                        self.search(map, marker, address);
                    }, 300);
                };

                basedFields.each(function(){
                    var el = $(this);

                    if (el.is('select')) {
                        el.change(onchange);
                    }
                    else {
                        el.keyup(onchange);
                    }
                });
            }
        };

        return {
            render: LocationField.render.bind(LocationField)
        };
    };

    function dataLocationFieldObserver(callback) {
        function _findAndEnableDataLocationFields() {
            var dataLocationFields = $('input[data-location-field-options]');

            dataLocationFields
                .filter(':not([data-location-field-observed])')
                .attr('data-location-field-observed', true)
                .each(callback);
        }

        var observer = new MutationObserver(function(){
            _findAndEnableDataLocationFields();
        });

        var container = document.documentElement || document.body;

        $(container).ready(function(){
            _findAndEnableDataLocationFields();
        });

        observer.observe(container, {attributes: true, childList: true, subtree: true});
    }

    dataLocationFieldObserver(function(){
        var el = $(this);

        var name = el.attr('name');
        var options = el.data('location-field-options');
        var basedFields = options.field_options.based_fields;
        var pluginOptions = {
            id: 'map_' + name,
            inputField: el,
            latLng: el.val() || '0,0',
            suffix: options['search.suffix'],
            path: options['resources.root_path'],
            provider: options['map.provider'],
            searchProvider: options['search.provider'],
            providerOptions: {
                google: {
                    api: options['provider.google.api'],
                    apiKey: options['provider.google.api_key'],
                    mapType: options['provider.google.map_type']
                },
                mapbox: {
                    access_token: options['provider.mapbox.access_token'],
                    maxZoom: options['provider.mapbox.max_zoom'],
                    id: options['provider.mapbox.id']
                },
                openstreetmap: {
                    maxZoom: options['provider.openstreetmap.max_zoom']
                },
                yandex: {
                    apiKey: options['provider.yandex.api_key']
                }
            },
            mapOptions: {
                zoom: options['map.zoom']
            }
        };

        var prefixNumber;

        try {
            prefixNumber = name.match(/-(\d+)-/)[1];
        } catch (e) {}

        if (options.field_options.prefix) {
            var prefix = options.field_options.prefix;

            if (prefixNumber != null) {
                prefix = prefix.replace(/__prefix__/, prefixNumber);
            }

            basedFields = basedFields.map(function(n){
                return prefix + n;
            });
        }

        pluginOptions.basedFields = $(basedFields.map(function(n){
            return '#id_' + n;
        }).join(','));

        $.locationField(pluginOptions).render();
    });

}(jQuery || django.jQuery);
