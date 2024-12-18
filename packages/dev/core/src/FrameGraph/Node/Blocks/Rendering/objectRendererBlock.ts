// eslint-disable-next-line import/no-internal-modules
import type { Scene, FrameGraph } from "core/index";
import { RegisterClass } from "../../../../Misc/typeStore";
import { editableInPropertyPage, PropertyTypeForEdition } from "../../../../Decorators/nodeDecorator";
import { FrameGraphObjectRendererTask } from "../../../Tasks/Rendering/objectRendererTask";
import { NodeRenderGraphBaseObjectRendererBlock } from "./baseObjectRendererBlock";

/**
 * Block that render objects to a render target
 */
export class NodeRenderGraphObjectRendererBlock extends NodeRenderGraphBaseObjectRendererBlock {
    /**
     * Create a new NodeRenderGraphObjectRendererBlock
     * @param name defines the block name
     * @param frameGraph defines the hosting frame graph
     * @param scene defines the hosting scene
     * @param doNotChangeAspectRatio True (default) to not change the aspect ratio of the scene in the RTT
     */
    public constructor(name: string, frameGraph: FrameGraph, scene: Scene, doNotChangeAspectRatio = true) {
        super(name, frameGraph, scene);

        this._additionalConstructionParameters = [doNotChangeAspectRatio];

        this._frameGraphTask = new FrameGraphObjectRendererTask(this.name, frameGraph, scene, { doNotChangeAspectRatio });
    }

    /** True (default) to not change the aspect ratio of the scene in the RTT */
    @editableInPropertyPage("Do not change aspect ratio", PropertyTypeForEdition.Boolean, "PROPERTIES")
    public get doNotChangeAspectRatio() {
        return this._frameGraphTask.objectRenderer.options.doNotChangeAspectRatio;
    }

    public set doNotChangeAspectRatio(value: boolean) {
        this._frameGraphTask.dispose();
        this._frameGraphTask = new FrameGraphObjectRendererTask(this.name, this._frameGraph, this._scene, { doNotChangeAspectRatio: value });
        this._additionalConstructionParameters = [value];
    }

    /** Indicates if shadows must be enabled or disabled */
    @editableInPropertyPage("Disable shadows", PropertyTypeForEdition.Boolean, "PROPERTIES")
    public get disableShadows() {
        return this._frameGraphTask.disableShadows;
    }

    public set disableShadows(value: boolean) {
        this._frameGraphTask.disableShadows = value;
    }

    /**
     * Gets the current class name
     * @returns the class name
     */
    public override getClassName() {
        return "NodeRenderGraphObjectRendererBlock";
    }

    protected override _dumpPropertiesCode() {
        const codes: string[] = [];
        codes.push(`${this._codeVariableName}.doNotChangeAspectRatio = ${this.doNotChangeAspectRatio};`);
        codes.push(`${this._codeVariableName}.disableShadows = ${this.disableShadows};`);
        return super._dumpPropertiesCode() + codes.join("\n");
    }

    public override serialize(): any {
        const serializationObject = super.serialize();
        serializationObject.doNotChangeAspectRatio = this.doNotChangeAspectRatio;
        serializationObject.disableShadows = this.disableShadows;
        return serializationObject;
    }

    public override _deserialize(serializationObject: any) {
        super._deserialize(serializationObject);
        this.doNotChangeAspectRatio = serializationObject.doNotChangeAspectRatio;
        this.disableShadows = serializationObject.disableShadows;
    }
}

RegisterClass("BABYLON.NodeRenderGraphObjectRendererBlock", NodeRenderGraphObjectRendererBlock);
