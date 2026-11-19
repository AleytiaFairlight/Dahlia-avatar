<script setup lang="ts">
// Dahlia: her memories as a map and a timeline (libs/dahlia-memory-map.ts). The map shows the people, pets, places and
// things of her ledger, each linked to the memories that name them; a click shows one's memories. The timeline lists
// her memories by month, or one entity's when one is picked. Settings > Modules > Long-Term Memory > Memory explorer
// shows it. This file is Dahlia's (AIRI has no such file).
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3'

import type { DahliaMapEntity, DahliaMapMemory, DahliaMapNode, DahliaMemoryMap } from '../../libs/dahlia-memory-map'

import { errorMessageFromValue } from '@proj-airi/stage-shared'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, select, zoom } from 'd3'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

import { buildDahliaMapGraph, dahliaMemoryTimeline, entitiesOf, fetchDahliaMemoryMap, MAP_COLORS, memoriesOf } from '../../libs/dahlia-memory-map'
import { useDahliaAuth } from '../../stores/dahlia-auth'

type Node = DahliaMapNode & SimulationNodeDatum
type Link = SimulationLinkDatum<Node>

const MAP_HEIGHT = 460

const auth = useDahliaAuth()
const view = shallowRef<'map' | 'timeline'>('map')
const map = shallowRef<DahliaMemoryMap>()
const loading = shallowRef(false)
const error = shallowRef<string>()
const selected = shallowRef<{ type: 'entity', entity: DahliaMapEntity } | { type: 'memory', memory: DahliaMapMemory }>()
const svg = useTemplateRef<SVGSVGElement>('svg')
let simulation: Simulation<Node, Link> | undefined

const graph = computed(() => map.value ? buildDahliaMapGraph(map.value) : undefined)
const selectedMemories = computed(() => map.value && selected.value?.type === 'entity' ? memoriesOf(map.value, selected.value.entity.id) : [])
const selectedEntities = computed(() => map.value && selected.value?.type === 'memory' ? entitiesOf(map.value, selected.value.memory.id) : [])
const timeline = computed(() => {
  if (!map.value)
    return []
  return dahliaMemoryTimeline(selected.value?.type === 'entity' ? selectedMemories.value : map.value.memories)
})

function day(at: string) {
  const date = new Date(at)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

async function load() {
  loading.value = true
  error.value = undefined
  try {
    map.value = await fetchDahliaMemoryMap()
  }
  catch (reason) {
    error.value = errorMessageFromValue(reason)
  }
  finally {
    loading.value = false
  }
}

function radius(node: Node) {
  return node.type === 'entity' ? 7 + Math.sqrt(node.degree) * 3 : 4
}

function color(node: Node) {
  return MAP_COLORS[node.type === 'entity' ? node.entity.kind : node.memory.kind] ?? MAP_COLORS['']
}

/** Draws the map with d3: a force layout that can be dragged around and zoomed. */
function draw() {
  simulation?.stop()
  const element = svg.value
  const current = graph.value
  if (!element || !current)
    return
  const width = element.clientWidth || 640
  const nodes: Node[] = current.nodes.map(node => ({ ...node }))
  const links: Link[] = current.links.map(link => ({ ...link }))

  const root = select(element)
  root.selectAll('*').remove()
  const layer = root.append('g')
  root.call(zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 4]).on('zoom', event => layer.attr('transform', event.transform)))

  const lines = layer.append('g').attr('stroke', 'currentColor').attr('stroke-opacity', 0.18).selectAll('line').data(links).join('line')
  const dots = layer.append('g').selectAll<SVGGElement, Node>('g').data(nodes).join('g').style('cursor', 'pointer')
  dots.append('circle').attr('r', radius).attr('fill', color).attr('stroke', 'white').attr('stroke-width', node => node.type === 'entity' ? 1.5 : 0.5)
  dots.append('title').text(node => node.type === 'entity' ? `${node.entity.name} (${node.entity.kind || 'someone or something'})` : node.memory.text)
  dots.filter(node => node.type === 'entity')
    .append('text')
    .text(node => node.type === 'entity' ? node.entity.name : '')
    .attr('x', node => radius(node) + 3)
    .attr('y', 4)
    .attr('font-size', 11)
    .attr('fill', 'currentColor')
  dots.on('click', (_event, node) => {
    selected.value = node.type === 'entity' ? { type: 'entity', entity: node.entity } : { type: 'memory', memory: node.memory }
  })

  simulation = forceSimulation(nodes)
    .force('link', forceLink<Node, Link>(links).id(node => node.id).distance(55))
    .force('charge', forceManyBody<Node>().strength(node => node.type === 'entity' ? -180 : -40))
    .force('center', forceCenter(width / 2, MAP_HEIGHT / 2))
    .force('collide', forceCollide<Node>(node => radius(node) + 3))
    .on('tick', () => {
      lines
        .attr('x1', link => (link.source as Node).x ?? 0)
        .attr('y1', link => (link.source as Node).y ?? 0)
        .attr('x2', link => (link.target as Node).x ?? 0)
        .attr('y2', link => (link.target as Node).y ?? 0)
      dots.attr('transform', node => `translate(${node.x ?? 0},${node.y ?? 0})`)
    })
}

watch([graph, view], async () => {
  if (view.value !== 'map')
    return
  await nextTick()
  draw()
})
watch(auth.session, () => void load())
onMounted(() => void load())
onBeforeUnmount(() => simulation?.stop())

function tabClass(active: boolean) {
  return [
    'rounded-lg px-3 py-1.5 text-sm transition-colors',
    active ? 'bg-primary-500 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700',
  ]
}
</script>

<template>
  <div data-testid="dahlia-memory-explorer" :class="['flex flex-col gap-3']">
    <div :class="['flex flex-wrap items-center gap-2']">
      <button type="button" :class="tabClass(view === 'map')" :aria-pressed="view === 'map'" @click="view = 'map'">
        Map
      </button>
      <button type="button" :class="tabClass(view === 'timeline')" :aria-pressed="view === 'timeline'" @click="view = 'timeline'">
        Timeline
      </button>
      <span v-if="selected?.type === 'entity'" :class="['ml-auto flex items-center gap-1 rounded-full bg-primary-100 px-2.5 py-1 text-xs text-primary-700 dark:bg-primary-900/50 dark:text-primary-200']">
        {{ selected.entity.name }}
        <button type="button" :class="['i-solar:close-circle-linear size-3.5']" aria-label="Show everyone" title="Show everyone" @click="selected = undefined" />
      </span>
      <button
        type="button"
        :class="['i-solar:refresh-bold-duotone size-5 text-neutral-500 hover:text-primary-500', selected?.type === 'entity' ? '' : 'ml-auto']"
        :disabled="loading"
        aria-label="Load again"
        title="Load again"
        @click="load"
      />
    </div>

    <p v-if="!auth.session.value" role="status" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
      Pass the voice check to see her memories.
    </p>
    <p v-else-if="error" role="alert" :class="['text-sm text-red-600 dark:text-red-400']">
      {{ error }}
    </p>
    <p v-else-if="loading && !map" role="status" :class="['text-sm text-neutral-500']">
      Loading her memories…
    </p>

    <template v-if="map && view === 'map'">
      <div :class="['relative overflow-hidden rounded-xl bg-neutral-50 text-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-200']">
        <svg ref="svg" data-testid="dahlia-memory-map" :class="['block w-full']" :height="MAP_HEIGHT" role="img" aria-label="Her memories and the people and things they name" />
        <p v-if="graph && graph.nodes.length === 0" :class="['absolute inset-0 m-0 flex items-center justify-center p-6 text-center text-sm text-neutral-500']">
          She hasn't noted anyone or anything by name yet.
        </p>
      </div>
      <p v-if="graph" :class="['m-0 text-xs text-neutral-500 dark:text-neutral-400']">
        {{ graph.nodes.filter(node => node.type === 'entity').length }} people and things, {{ map.memories.length - graph.unlinked }} memories that name them;
        {{ graph.unlinked }} more name no one and are in the timeline. Drag to move, scroll to zoom, click for details.
      </p>
      <div v-if="selected" :class="['flex flex-col gap-2 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-800/60']">
        <template v-if="selected.type === 'entity'">
          <h3 :class="['m-0 flex items-center gap-2 text-sm font-medium']">
            <span :class="['size-3 rounded-full']" :style="{ background: MAP_COLORS[selected.entity.kind] ?? MAP_COLORS[''] }" />
            {{ selected.entity.name }}
            <span :class="['text-xs text-neutral-500']">{{ selected.entity.kind }}{{ selected.entity.aliases.length ? ` · ${selected.entity.aliases.join(', ')}` : '' }}</span>
          </h3>
          <ul :class="['m-0 flex flex-col gap-1 p-0 list-none']">
            <li v-for="memory in selectedMemories" :key="memory.id" :class="['rounded-lg bg-white px-2.5 py-1.5 text-sm dark:bg-neutral-900/60']">
              <span :class="['mr-1 text-xs text-neutral-500']">{{ day(memory.createdAt) }}</span>{{ memory.text }}
            </li>
          </ul>
        </template>
        <template v-else>
          <p :class="['m-0 text-sm']">
            <span :class="['mr-1 text-xs text-neutral-500']">{{ day(selected.memory.createdAt) }} · {{ selected.memory.kind }}</span>{{ selected.memory.text }}
          </p>
          <div :class="['flex flex-wrap gap-1.5']">
            <button
              v-for="entity in selectedEntities"
              :key="entity.id"
              type="button"
              :class="['rounded-full bg-white px-2 py-0.5 text-xs hover:bg-primary-100 dark:bg-neutral-900/60 dark:hover:bg-primary-900/50']"
              @click="selected = { type: 'entity', entity }"
            >
              {{ entity.name }}
            </button>
          </div>
        </template>
      </div>
    </template>

    <div v-if="map && view === 'timeline'" data-testid="dahlia-memory-timeline" :class="['flex flex-col gap-4']">
      <p v-if="timeline.length === 0" :class="['text-sm text-neutral-500']">
        No memories yet.
      </p>
      <section v-for="month in timeline" :key="month.key" :class="['flex flex-col gap-1.5']">
        <h3 :class="['m-0 text-sm font-medium text-neutral-600 dark:text-neutral-300']">
          {{ month.label }} <span :class="['text-xs text-neutral-400']">{{ month.memories.length }}</span>
        </h3>
        <ol :class="['m-0 flex flex-col gap-1 border-l-2 border-primary-200 py-0 pl-3 list-none dark:border-primary-800']">
          <li v-for="memory in month.memories" :key="memory.id" :class="['relative text-sm']">
            <span :class="['absolute -left-[17px] top-1.5 size-2 rounded-full']" :style="{ background: MAP_COLORS[memory.kind] ?? MAP_COLORS[''] }" />
            <span :class="['mr-1 text-xs text-neutral-500']">{{ day(memory.createdAt) }}</span>{{ memory.text }}
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>
