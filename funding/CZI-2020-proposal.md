# CZI 2020

We submitted an application for funding from the Chan Zuckerberg Initiative
for their [Essential Open Source Software for Science](https://chanzuckerberg.com/rfa/essential-open-source-software-for-science/)
grant.

Here are some excerpts from the application:

## Abstract

Jupyter Notebook documents are meant to be shared. They encourage reproducibility, readability, and collaboration. However, a major limitation of using Jupyter for collaboration is that multiple people cannot compose a Notebook together in real-time. To address this limitation, we will build the underlying infrastructure to enable real-time collaboration (RTC) in Jupyter. This will also open the door for RTC beyond Notebooks—laying the foundation for RTC for different types of datasets and visualizations. Furthermore, we will build for extensibility—working with the open-source community to build an RTC API from which other projects can benefit. 

## Work Plan

 Real-time collaboration (RTC) in Jupyter is one of the most desired features in the Jupyter Community. However, RTC requires changes at multiple levels of the Jupyter ecosystem and a strong technical foundation to be viable. Today, with the flexibility of the JupyterLab frontend and the development of the Conflict Free Replicated Data Type (CRDT) implementation in Lumino, we are ready to move forward on this vision. Adding a real-time collaboration experience to something like a Jupyter Notebook requires a new mechanism to smoothly handle conflict resolution in complicated, nested document formats. Fortunately, if we create a solution for Jupyter Notebooks—which are deeply nested and complicated document formats—we can extrapolate to many other document types.

The funding from this grant will enable us to coordinate efforts with lead developers from key subprojects in the Jupyter ecosystem—including Jupyter Server, JupyterLab, and Lumino. Together, we will build the pieces necessary to build an RTC experience inside Jupyter.

Specifically, we use this funding to build…
1. A generic, real-time data model and storage API. These data models can receive changes from many different “clients” and deterministically resolve a “current state” of the model using the CRDTs. The history of the model will be stored on the server as a set of change patches to facilitate replication across clients and undo/redo queries.
2. A Jupyter client using CRDTs, which entails a frontend and backend component, to support multiple simultaneous clients.
3. Server for replicating CRDT patches between clients.
4. A UI for real-time collaboration in JupyterLab.
5. Real-time commenting within Jupyter Notebooks.

The outcomes of this proposal will be:
1. An extensible API for client-side applications to implement a real-time collaboration experience for different document types.
2. An improvement in the notebook experience, which will be achieved by retaining output results even if you close your browser. This is one of the longest running and most requested Jupyter features. This is useful for people who have long running notebook computations who want to preserve their results despite network interruptions.
3. The addition of undo/redo support to allow a more natural notebook editing experience.
4. Laying the foundation for collaborative user experiences, such as commenting, annotation, and change suggestions.

We will move forward on this work by:
1. Using GitHub issues and milestones to track our progress and deliverables.
2. Having regular public meetings to discuss changes and invite input from other stakeholders.
3. Integrate our libraries as a dependency of JupyterLab. 

## Milestones and Deliverables

Project deliverables will be comprised of multiple different libraries openly published and documented within the JupyterLab GitHub organization.

1. Develop generic real-time data model API
   1. Release robust CRDT implementation (August 2020)
   2. Add undo/redo support to CRDT (July 2020)
   3. Publish initial version of real-time data model package, including RXJS and React integration (August 2020)
2. Develop real-time data model for Jupyter-specific models.
   1. Publish initial version of Jupyter data model based on Jupyter networking specification and APIs (September 2020)
3. Add infrastructure for RTC experience in Jupyter (October 2020)
   1. Publish client API for Jupyter data model and server API
   2. Release Jupyter server extension which connects to server API
   3. Release JupyterLab extension which exposes access to client API
4. Add new UI to JupyterLab for RTC experience.
   1. Switch underlying data model to rely on real-time data store (February 2021)
   2. Update the UI to allow for the display of comments based on user requirements. (February 2021)
   3. Ensure the absence of any unacceptable performance regressions in Jupyterlab (March 2021)
   4. Document changes for extension developers interfacing with JupyterLab models and release with JupyterLab version 3.0 (June 2021)
